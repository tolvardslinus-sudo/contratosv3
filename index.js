import express from "express";
import axios from "axios";
import OpenAI from "openai";
//import dotenv from "dotenv";

//dotenv.config();

// TEMPORAL - borrar después


const app = express();
app.use(express.json());

// Solo carga .env en local, en Railway las variables ya están en process.env
if (process.env.NODE_ENV !== "production") {
    const dotenv = await import("dotenv");
    dotenv.default.config();
}

const API_URL = process.env.API_URL;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY no definida. Abortando.");
    process.exit(1);
}


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
            name: "eliminar_persona",
            description: "Elimina una persona por su _id de MongoDB",
            parameters: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: "ID (_id) de la persona en MongoDB, por ejemplo: 69d78b077071dadef5655fbb"
                    }
                },
                required: ["id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "eliminar_contrato",
            parameters: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: "ID del contrato (_id de Mongo)"
                    }
                },
                required: ["id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "crear_contrato",
            description: "Crea un contrato entre prestamistas y prestatarios",
            parameters: {
                type: "object",
                properties: {
                    prestamistas: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                persona: { type: "string", description: "ID de la persona" },
                                monto: { type: "number", description: "Monto prestado" }
                            },
                            required: ["persona", "monto"]
                        }
                    },
                    prestatarios: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                persona: { type: "string", description: "ID de la persona" }
                            },
                            required: ["persona"]
                        }
                    },
                    plazo: { type: "number" },
                    tasaInteres: { type: "number" },
                    fecha: { type: "string" },
                    estado: { type: "string" },
                    observaciones: { type: "string" }
                },
                required: ["prestamistas", "prestatarios", "plazo", "tasaInteres", "fecha", "estado"]
            }
        }
    }
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
            const today = new Date().toISOString().split("T")[0];

            let fecha = args.fecha;

            if (!fecha) {
                fecha = today;
            } else {
                const f = fecha.toLowerCase().trim();

                if (f.includes("hoy")) {
                    fecha = today;
                }

                // si viene formato ISO
                if (fecha.includes("T")) {
                    fecha = fecha.split("T")[0];
                }
            }

            const finalArgs = {
                ...args,
                fecha
            };

            console.log("ARGS ORIGINALES:", args);
            console.log("ARGS FINALES:", finalArgs);

            const res = await axios.post(`${API_URL}/contratos`, finalArgs);
            return res.data;
        }
        case "eliminar_persona": {
            const res = await axios.delete(`${API_URL}/personas/${args.id}`);
            return res.data;
        }

        case "eliminar_contrato": {
            const res = await axios.delete(`${API_URL}/contratos/${args.id}`);
            return res.data;
        }
        default:
            return { error: `Tool desconocida: ${name}` };
    }
}

app.post("/chat", async (req, res) => {
    const { messages } = req.body;
    const today = new Date().toISOString().split("T")[0];
    const systemMessage = {
        role: "system",
        content: `
Eres un asistente que gestiona contratos financieros.

Fecha actual: ${today}

Reglas IMPORTANTES:
- Si el usuario pregunta por la fecha actual, usa la fecha proporcionada arriba
- NO inventes fechas
- Usa siempre la fecha actual del sistema
- Un contrato tiene prestamistas y prestatarios
- Si el usuario dice "de X para Y":
   → X = prestamista
   → Y = prestatario
   - Para eliminar una persona o contrato, primero debes obtener su ID
- Puedes usar buscar_persona o listar_contratos
- Nunca inventes IDs
`
    };

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "El campo 'messages' es requerido y debe ser un array" });
    }

    try {
        log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        log(`💬 Nueva petición con ${messages.length} mensaje(s)`);
        log(`📨 Último mensaje: "${messages[messages.length - 1].content}"`);

        let response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [systemMessage, ...messages],
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
                messages: [systemMessage, ...allMessages],
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