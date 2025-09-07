// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "agora-token";   // 👈 import the whole package

const { RtcTokenBuilder, RtcRole } = pkg; // 👈 destructure here

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Agora credentials
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

if (!APP_ID || !APP_CERTIFICATE) {
  console.error("❌ Missing Agora APP_ID or APP_CERTIFICATE in .env");
  process.exit(1);
}

// Generate token endpoint
app.post("/create-token", (req, res) => {
  try {
    const { channelName, uid } = req.body;

    if (!channelName || uid === undefined) {
      return res.status(400).json({ error: "channelName and uid are required" });
    }

    // Token expires in 1 hour
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    // Build token
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpiredTs
    );

    return res.json({ token });
  } catch (error) {
    console.error("Token generation error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Agora Token Server running on http://localhost:${PORT}`);
});
