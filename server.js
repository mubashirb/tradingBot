import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v20.0";

// --- 1) Webhook verification: Meta calls this once when you "Verify and save"
app.get("/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2) Incoming messages: Meta POSTs here on every inbound msg
const seen = new Set(); // use Redis/DB in production

app.post("/webhooks/whatsapp", async (req, res) => {
  // ACK fast (Meta expects a quick 200)
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const waMessageId = msg.id;
    if (seen.has(waMessageId)) return;
    seen.add(waMessageId);

    const from = msg.from;

    // Handle text "hi/menu"
    if (msg.type === "text") {
      const text = (msg.text?.body || "").trim().toLowerCase();
      if (["hi", "hello", "menu", "start"].includes(text)) {
        await sendMainMenu(from);
      }
    }
  } catch (e) {
    console.error("Webhook processing error:", e?.response?.data || e.message);
  }
});

// --- 3) Send interactive LIST menu (WhatsApp Cloud API)
async function sendMainMenu(to) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "PSX Trading Bot" },
      body: { text: "Choose an option:" },
      footer: { text: "Tap an option (no typing needed)." },
      action: {
        button: "Main Menu",
        sections: [
          {
            title: "Trading",
            rows: [
              { id: "TRADE_BUY", title: "Buy", description: "Place a buy order" },
              { id: "TRADE_SELL", title: "Sell", description: "Place a sell order" },
              { id: "TRADE_QUOTE", title: "Quote", description: "Get latest price" }
            ]
          },
          {
            title: "Account",
            rows: [
              { id: "ACC_PORTFOLIO", title: "Portfolio", description: "Holdings & P/L" },
              { id: "ACC_ORDERS", title: "Orders", description: "Open/filled orders" }
            ]
          }
        ]
      }
    }
  };

  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

// Render requires binding to process.env.PORT
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
