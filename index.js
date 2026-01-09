// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

import pkg from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = pkg;

import admin from "firebase-admin";
import { readFileSync } from "fs";

// --- Load environment variables ---
dotenv.config();

// --- Load service account ---
const serviceAccount = JSON.parse(
  readFileSync("./service_account_key.json", "utf8")
);

// --- Initialize Firebase Admin ---
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// --- Express setup ---
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Agora Credentials ---
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

if (!APP_ID || !APP_CERTIFICATE) {
  console.error("❌ Missing Agora APP_ID or APP_CERTIFICATE in .env");
  process.exit(1);
}

//
// ✅ 1️⃣ CREATE AGORA TOKEN ENDPOINT
//
app.post("/create-token", (req, res) => {
  try {
    const { channelName, uid, account } = req.body;

    if (!channelName || (uid === undefined && !account)) {
      return res.status(400).json({
        error: "channelName and either uid or account are required",
      });
    }

    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    let token;
    if (uid !== undefined) {
      token = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERTIFICATE,
        channelName,
        Number(uid),
        RtcRole.PUBLISHER,
        privilegeExpiredTs
      );
    } else {
      token = RtcTokenBuilder.buildTokenWithAccount(
        APP_ID,
        APP_CERTIFICATE,
        channelName,
        account,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
      );
    }

    return res.json({ token });
  } catch (error) {
    console.error("❌ Token generation error:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});



async function sendCallUpdate(tokens, type, callId) {
  const messages = tokens.map((token) => ({
    token,
    data: {
      type,
      callId,
    },
    notification: {
      title: type === "call_rejected" ? "Call Rejected" : "Missed Call",
      body: type === "call_rejected"
        ? "The callee rejected your call."
        : "Call not answered.",
    },
    android: {
      priority: "high",
      notification: {
        channelId: "incoming_call_channel",
        priority: "max",
      }
    }
  }));

  try {
    return await admin.messaging().sendEach(messages);
  } catch (err) {
    console.error("❌ Error sending update:", err);
  }
}


//
// ✅ 2️⃣ SEND INCOMING CALL NOTIFICATION ENDPOINT
//
async function sendIncomingCallDataMessage(tokens, dataPayload, callerName) {
  if (!tokens || tokens.length === 0) return { success: 0, failure: 0, responses: [] };

  // Create individual messages for each token
  const messages = tokens.map((token) => ({
    token: token,
    data: dataPayload, // Data payload for app logic
    // CRITICAL: Add notification payload for when app is killed


    notification: {
      title: 'Incoming Call',
      body: `${callerName} is calling...`,
    },
    android: {
      priority: "high",
      ttl: 60 * 1000,
      notification: {
        channelId: 'incoming_call_channel',
        priority: 'max',
        defaultSound: true,
        defaultVibrateTimings: true,
        tag: dataPayload.callId, // Groups notifications
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-expiration": `${Math.floor(Date.now() / 1000 + 60)}`,
      },
      payload: {
        aps: {
          "content-available": 1,
          alert: {
            title: 'Incoming Call',
            body: `${callerName} is calling...`,
          },
          sound: 'default',
          category: 'CALL_INVITATION',
        },
      },
    },
  }));

  try {
    const response = await admin.messaging().sendEach(messages);
    
    console.log(`✅ FCM sent: ${response.successCount} success, ${response.failureCount} failures`);
    
    return response;
  } catch (err) {
    console.error("❌ FCM send error:", err);
    throw err;
  }
}

app.post("/incoming-call", async (req, res) => {
  try {
    const { callerId, callerName, calleeId, calleeTokens, meetingDocId, type } = req.body;

    if (!callerId || !calleeId || !calleeTokens) {
      return res.status(400).json({ error: "callerId, calleeId and calleeTokens are required" });
    }

    const tokens = Array.isArray(calleeTokens) ? calleeTokens : [calleeTokens];

    const callId = meetingDocId;
    const channel = meetingDocId;


    const dataPayload = {
      type: "incoming_call",
      callId: callId,
      callerId: callerId,
      callerName: callerName || "Unknown",
      channel: channel,
      callType: type,
    };

    // Pass callerName for notification
    const fcmResponse = await sendIncomingCallDataMessage(tokens, dataPayload, callerName || "Unknown");

    // Clean invalid tokens (same as before)
    const tokensToRemove = [];
    if (fcmResponse && fcmResponse.responses) {
      fcmResponse.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const err = resp.error;
          if (
            err.code === "messaging/registration-token-not-registered" ||
            err.code === "messaging/invalid-registration-token"
          ) {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });
    }

    if (tokensToRemove.length > 0) {
      const userRef = db.collection("users").doc(calleeId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return;
        const data = snap.data();
        const existing = data && data.fcmTokens ? data.fcmTokens : [];
        const updated = existing.filter((t) => !tokensToRemove.includes(t));
        tx.update(userRef, { fcmTokens: updated });
      });
    } 

    return res.json({ 
      ok: true, 
      callId,
      channel,
      fcmResponse: {
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
      }
    });
  } catch (err) {
    console.error("❌ Error in /incoming-call:", err);
    return res.status(500).json({ error: "internal_server_error", details: err.message });
  }
});


//
// ✅ 3️⃣ SERVER START
//
app.listen(PORT,'0.0.0.0', () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📱 Firebase Admin SDK initialized`);
  console.log(`🎥 Agora App ID: ${APP_ID}`);
});