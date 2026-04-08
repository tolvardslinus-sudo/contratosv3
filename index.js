import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const API_URL = process.env.API_URL;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const log = (msg) => console.log(`[CHAT] ${msg}`);

let totalTokens = { prompt: 0, completion: 0, total: 0 };

const logTokens = (usage, label = "") => {
    if (!usage) return;
    totalTokens.prompt += usage.prompt_tokens;
    totalTokens.completion += usage.completion_tokens;
    totalTokens.total += usage.total_tokens;
    log(`🪙 Tokens ${label} | prompt: ${usage.prompt_tokens} | completion: ${usage.completion_tokens} | total: ${usage.total_tokens}`);
    log(`🪙 Tokens acumulados | prompt: ${totalTokens.prompt} | completion: ${totalTokens.completion} | total: ${totalTokens.total}`);
};

const tools = [
    {
        type: "function",
        function: {
            name: "listar_personas",
            description: "Obtiene todas las personas",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "buscar_persona",
            description: "Busca persona por nombre",
            parameters: {
                type: "object",
                properties: { nombre: { type: "string" } },
                required: ["nombre"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "crear_persona",
            description: "Crea una nueva persona",
            parameters: {
                type: "object",
                properties: {
                    nombres: { type: "string" },
                    apellidos: { type: "string" },
                    dni: { type: "string" },
                    celular: { type: "string" },
                },
                required: ["nombres", "apellidos"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "listar_contratos",
            description: "Obtiene todos los contratos",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "crear_contrato",
            description: "Crea un contrato",
            parameters: {
                type: "object",
                properties: { data: { type: "object" } },
                required: ["data"],
            },
        },
    },
];

async function executeTool(name, args) {
    log(`🔧 Tool: ${name} | args: ${JSON.stringify(args)}`);
    switch (name) {
        case "listar_personas": {
            const res = await axios.get(`${API_URL}/personas`);
            return res.data;
        }
        case "buscar_persona": {
            const res = await axios.get(`${API_URL}/personas/${args.nombre}`);
            return res.data;
        }
        case "crear_persona": {
            const res = await axios.post(`${API_URL}/personas`, args);
            return res.data;
        }
        case "listar_contratos": {
            const res = await axios.get(`${API_URL}/allcontratos`);
            return res.data;
        }
        case "crear_contrato": {
            const res = await axios.post(`${API_URL}/contratos`, args.data);
            return res.data;
        }
        default:
            return { error: `Tool desconocida: ${name}` };
    }
}

app.post("/chat", async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "El campo 'messages' es requerido y debe ser un array" });
    }

    try {
        log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        log(`💬 Nueva petición con ${messages.length} mensaje(s)`);
        log(`📨 Último mensaje: "${messages[messages.length - 1].content}"`);

        let response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools,
            tool_choice: "auto",
        });

        log(`🤖 OpenAI respondió | finish_reason: ${response.choices[0].finish_reason}`);
        logTokens(response.usage, "llamada #1");

        let assistantMessage = response.choices[0].message;
        const allMessages = [...messages, assistantMessage];
        let callCount = 1;

        while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            log(`📋 Llamando ${assistantMessage.tool_calls.length} tool(s): ${assistantMessage.tool_calls.map(t => t.function.name).join(", ")}`);

            const toolResults = await Promise.all(
                assistantMessage.tool_calls.map(async (toolCall) => {
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await executeTool(toolCall.function.name, args);
                    log(`📦 Resultado de "${toolCall.function.name}": ${JSON.stringify(result).slice(0, 120)}...`);
                    return {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result),
                    };
                })
            );

            allMessages.push(...toolResults);
            callCount++;

            log(`🔄 Enviando resultados de tools a OpenAI... (llamada #${callCount})`);
            response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: allMessages,
                tools,
                tool_choice: "auto",
            });

            log(`🤖 OpenAI respondió de nuevo | finish_reason: ${response.choices[0].finish_reason}`);
            logTokens(response.usage, `llamada #${callCount}`);

            assistantMessage = response.choices[0].message;
            allMessages.push(assistantMessage);
        }

        log(`✅ Respuesta final: "${assistantMessage.content?.slice(0, 120)}..."`);
        log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        res.json({ reply: assistantMessage.content });
    } catch (error) {
        log(`❌ Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`🚀 Servidor corriendo en puerto ${PORT}`);
    log(`🪙 Contador de tokens iniciado en 0`);
});