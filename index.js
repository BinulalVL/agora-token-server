import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "agora-token";

const { RtcTokenBuilder, RtcRole } = pkg;

dotenv.config();

const app = express();

// Add these middleware in the correct order
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
  console.log("📥 Request headers:", req.headers);
  console.log("📥 Request body:", req.body);
  
  try {
    const { channelName, uid, account } = req.body;
    
    console.log("🔍 Parsed values:");
    console.log("  channelName:", channelName);
    console.log("  uid:", uid);
    console.log("  account:", account);

    // Improved validation
    if (!channelName || channelName.trim() === '') {
      console.log("❌ Missing or empty channelName");
      return res.status(400).json({ 
        error: "channelName is required and cannot be empty" 
      });
    }

    if (uid === undefined && (!account || account.trim() === '')) {
      console.log("❌ Missing both uid and account");
      return res.status(400).json({ 
        error: "Either uid or account is required" 
      });
    }

    // Token expires in 1 hour
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    let token;

    if (account && account.trim() !== '') {
      console.log("✅ Generating token with account:", account);
      token = RtcTokenBuilder.buildTokenWithAccount(
        APP_ID,
        APP_CERTIFICATE,
        channelName.trim(),
        account.trim(),
        RtcRole.PUBLISHER,
        privilegeExpiredTs
      );
    } else if (uid !== undefined) {
      console.log("✅ Generating token with uid:", uid);
      token = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERTIFICATE,
        channelName.trim(),
        uid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
      );
    }

    console.log("✅ Token generated successfully");
    return res.json({ token });
    
  } catch (error) {
    console.error("❌ Token generation error:", error);
    return res.status(500).json({ 
      error: "Internal server error: " + error.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`✅ Agora Token Server running on port ${PORT}`);
});