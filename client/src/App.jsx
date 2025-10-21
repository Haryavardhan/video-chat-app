// App.jsx
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// ✅ Replace with your Render backend URL
const SERVER = "https://video-chat-app-jrt9.onrender.com";
const socket = io(SERVER, { transports: ["websocket", "polling"] });

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peer = useRef(null);
  const localStream = useRef(null);

  // ==========================
  // 🔁 Socket event listeners
  // ==========================
  useEffect(() => {
    socket.on("peer-joined", async (peerId) => {
      console.log("Peer joined:", peerId);
      await startCall(true);
    });

    socket.on("offer", handleReceiveOffer);
    socket.on("answer", handleAnswer);
    socket.on("candidate", handleCandidate);
    socket.on("receive_message", (msg) => setChat((prev) => [...prev, msg]));

    // cleanup on unmount
    return () => {
      socket.off("peer-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("candidate");
      socket.off("receive_message");

      if (peer.current) {
        peer.current.close();
        peer.current = null;
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach((t) => t.stop());
        localStream.current = null;
      }
    };
  }, []);

  // ==========================
  // 🚪 Join Room
  // ==========================
  const joinRoom = () => {
    if (!roomId.trim()) return alert("Enter room ID");
    socket.emit("join-room", roomId.trim());
    setJoined(true);
  };

  // ==========================
  // 📞 Start Call Function
  // ==========================
  async function startCall(isInitiator) {
    try {
      // Create PeerConnection
      if (!peer.current) {
        peer.current = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        // Remote stream setup
        peer.current.ontrack = (e) => {
          if (remoteVideo.current && e.streams[0]) {
            console.log("🎥 Remote stream received");
            remoteVideo.current.srcObject = e.streams[0];
          }
        };

        // Send ICE candidates
        peer.current.onicecandidate = (e) => {
          if (e.candidate) {
            socket.emit("candidate", { roomId, candidate: e.candidate });
          }
        };

        peer.current.oniceconnectionstatechange = () =>
          console.log("ICE state:", peer.current.iceConnectionState);
      }

      // Get local media (camera + mic)
      if (!localStream.current) {
        localStream.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideo.current)
          localVideo.current.srcObject = localStream.current;

        localStream.current.getTracks().forEach((track) =>
          peer.current.addTrack(track, localStream.current)
        );
      }

      // If initiator, create and send offer
      if (isInitiator) {
        const offer = await peer.current.createOffer();
        await peer.current.setLocalDescription(offer);
        socket.emit("offer", { roomId, offer });
        console.log("📤 Offer sent");
      }
    } catch (err) {
      console.error("startCall error:", err);
    }
  }

  // ==========================
  // 📨 Handle Offer
  // ==========================
  async function handleReceiveOffer(payload) {
    try {
      const { offer } = payload;
      console.log("📩 Offer received");
      await startCall(false);
      await peer.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await peer.current.createAnswer();
      await peer.current.setLocalDescription(answer);
      socket.emit("answer", { roomId, answer });
      console.log("📤 Answer sent");
    } catch (err) {
      console.error("handleReceiveOffer error:", err);
    }
  }

  // ==========================
  // 📨 Handle Answer
  // ==========================
  async function handleAnswer(payload) {
    try {
      const { answer } = payload;
      console.log("📩 Answer received");
      if (!peer.current) return console.warn("No peer yet");
      await peer.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    } catch (err) {
      console.error("handleAnswer error:", err);
    }
  }

  // ==========================
  // 🧊 Handle ICE Candidate
  // ==========================
  async function handleCandidate(payload) {
    try {
      const { candidate } = payload;
      if (!candidate) return;
      if (!peer.current)
        return console.warn("No peer to add ICE candidate to");
      await peer.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("handleCandidate error:", err);
    }
  }

  // ==========================
  // 💬 Chat Messaging
  // ==========================
  const sendMessage = () => {
    if (!message.trim()) return;
    const msg = { message: message.trim(), from: socket.id, time: Date.now() };
    socket.emit("send_message", { roomId, message: msg });
    setChat((p) => [...p, msg]);
    setMessage("");
  };

  // ==========================
  // 🎨 UI
  // ==========================
  return (
    <div
      style={{
        textAlign: "center",
        padding: 20,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h2>🎥 Video & Chat (WebRTC + Socket.IO)</h2>

      {!joined ? (
        <div style={{ marginBottom: 12 }}>
          <input
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ padding: 8 }}
          />
          <button
            onClick={joinRoom}
            style={{ marginLeft: 8, padding: "8px 12px" }}
          >
            Join Room
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => startCall(true)}
            style={{ padding: "8px 12px" }}
          >
            Start Call
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <video
          ref={localVideo}
          autoPlay
          muted
          playsInline
          style={{ width: 320, height: 240, background: "#000" }}
        />
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          style={{ width: 320, height: 240, background: "#000" }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="text"
          placeholder="Enter message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ padding: 8, width: 300 }}
        />
        <button
          onClick={sendMessage}
          style={{ marginLeft: 8, padding: "8px 12px" }}
        >
          Send
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          textAlign: "left",
          width: 660,
          margin: "12px auto",
        }}
      >
        <h4>Chat</h4>
        <div
          style={{
            maxHeight: 220,
            overflow: "auto",
            border: "1px solid #ddd",
            padding: 8,
          }}
        >
          {chat.map((c, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <small style={{ color: "#666" }}>
                {c.from ? `${c.from.substring(0, 6)}:` : ""}{" "}
                {c.time ? new Date(c.time).toLocaleTimeString() : ""}
              </small>
              <div>{c.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
