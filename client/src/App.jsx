// App.jsx
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER = "https://video-chat-app-jrt9.onrender.com"; // your actual Render backend URL
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

  useEffect(() => {
    // Register socket listeners
    socket.on("peer-joined", handlePeerJoined);
    socket.on("offer", handleReceiveOffer);
    socket.on("answer", handleAnswer);
    socket.on("candidate", handleCandidate);
    socket.on("receive_message", (msg) => setChat((prev) => [...prev, msg]));

    // cleanup on unmount
    return () => {
      socket.off("peer-joined", handlePeerJoined);
      socket.off("offer", handleReceiveOffer);
      socket.off("answer", handleAnswer);
      socket.off("candidate", handleCandidate);
      socket.off("receive_message");
      // close peer & tracks
      if (peer.current) {
        peer.current.close();
        peer.current = null;
      }
      if (localStream.current) {
        localStream.current.getTracks().forEach((t) => t.stop());
        localStream.current = null;
      }
      // don't disconnect socket here if you want reuse across app; if you want, uncomment:
      // socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Join the room
  const joinRoom = () => {
    if (!roomId.trim()) return alert("Enter room ID");
    socket.emit("join-room", roomId.trim());
    setJoined(true);
  };

  // When a peer joins, create an offer (initiator)
  const handlePeerJoined = async (peerId) => {
    console.log("peer joined:", peerId);
    // Only create offer if we already joined (prevents weird race)
    if (!joined) return;
    await startCall(true);
  };

  // Core: start the call and create RTCPeerConnection
  async function startCall(isInitiator) {
    try {
      // If we already have a peer, don't recreate (reuse)
      if (!peer.current) {
        peer.current = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            // Add TURN servers here if you have them: { urls: "turn:your.turn.server", username, credential }
          ],
        });

        // when remote track arrives
        peer.current.ontrack = (e) => {
          if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
        };

        // on ICE candidate -> send to signaling server
        peer.current.onicecandidate = (e) => {
          if (e.candidate) {
            socket.emit("candidate", { roomId, candidate: e.candidate });
          }
        };

        // optional: debug ICE state changes
        peer.current.oniceconnectionstatechange = () =>
          console.log("ICE state:", peer.current.iceConnectionState);
      }

      // get local media (if not already)
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
        // add tracks to peer
        stream.getTracks().forEach((track) => peer.current.addTrack(track, stream));
      }

      if (isInitiator) {
        const offer = await peer.current.createOffer();
        await peer.current.setLocalDescription(offer);
        socket.emit("offer", { roomId, offer });
        console.log("Offer sent");
      }
    } catch (err) {
      console.error("startCall error:", err);
    }
  }

  // Receive offer from remote -> set remote desc, create + send answer
  async function handleReceiveOffer(payload) {
    try {
      // payload expected: { offer, from }
      const { offer } = payload;
      console.log("Received offer", offer && !!offer.sdp);
      // create peer if doesn't exist and add local media
      await startCall(false);
      await peer.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.current.createAnswer();
      await peer.current.setLocalDescription(answer);
      socket.emit("answer", { roomId, answer });
      console.log("Answer sent");
    } catch (err) {
      console.error("handleReceiveOffer error:", err);
    }
  }

  // Receive answer from remote -> set remote desc
  async function handleAnswer(payload) {
    try {
      const { answer } = payload;
      console.log("Received answer", answer && !!answer.sdp);
      if (!peer.current) return console.warn("No peer when receiving answer");
      await peer.current.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error("handleAnswer error:", err);
    }
  }

  // Receive ICE candidate -> add to peer
  async function handleCandidate(payload) {
    try {
      const { candidate } = payload;
      if (!candidate) return;
      if (!peer.current) {
        console.warn("No peer yet to add candidate to, buffering not implemented.");
        return;
      }
      await peer.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("handleCandidate error:", err);
    }
  }

  // Send chat
  const sendMessage = () => {
    if (!message.trim()) return;
    const msg = { message: message.trim(), from: socket.id, time: Date.now() };
    socket.emit("send_message", { roomId, message: msg });
    setChat((p) => [...p, msg]);
    setMessage("");
  };

  return (
    <div style={{ textAlign: "center", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>🎥 Video & Chat (LAN)</h2>

      {!joined ? (
        <div style={{ marginBottom: 12 }}>
          <input
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ padding: 8 }}
          />
          <button onClick={joinRoom} style={{ marginLeft: 8, padding: "8px 12px" }}>
            Join Room
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => startCall(true)} style={{ padding: "8px 12px" }}>
            Start Call (Initiate)
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
        <button onClick={sendMessage} style={{ marginLeft: 8, padding: "8px 12px" }}>
          Send
        </button>
      </div>

      <div style={{ marginTop: 12, textAlign: "left", width: 660, margin: "12px auto" }}>
        <h4>Chat</h4>
        <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #ddd", padding: 8 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <small style={{ color: "#666" }}>
                {c.from ? `${c.from.substring(0, 6)}:` : ""}{" "}
                {c.time ? new Date(c.time).toLocaleTimeString() : ""}
              </small>
              <div>{c.message || (c.message && c.message.message) || JSON.stringify(c)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
