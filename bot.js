const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@adiwajshing/baileys");
const express = require("express");
const fs = require("fs");

const SAVED_NUMBERS_FILE = "saved_numbers.json";

// Helper to load and save numbers
function loadSavedNumbers() {
    if (!fs.existsSync(SAVED_NUMBERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(SAVED_NUMBERS_FILE));
    } catch {
        return [];
    }
}
function saveNumbers(numbers) {
    fs.writeFileSync(SAVED_NUMBERS_FILE, JSON.stringify(numbers, null, 2));
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key.fromMe && msg.key.remoteJid.endsWith("@s.whatsapp.net")) {
                const phone = msg.key.remoteJid.split("@")[0];
                let numbers = loadSavedNumbers();
                if (!numbers.includes(phone)) {
                    numbers.push(phone);
                    saveNumbers(numbers);
                    console.log(`Saved new number: ${phone}`);
                }
            }
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log("Logged out.");
            }
        }
    });
}

// Express server for health/status
const app = express();

app.get("/", (req, res) => {
    res.send("WhatsApp Auto-Save bot is running.");
});
app.get("/numbers", (req, res) => {
    res.json(loadSavedNumbers());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Express server listening on port", PORT);
    startBot();
});