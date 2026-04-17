const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(__dirname));
app.use(express.json());

// 🔥 RECEIVE CHAT FROM STREAMER.BOT
app.get("/chat", (req, res) => {

    const user = req.query.user;
    const guess = req.query.message;

    if (!user || !guess) {
        return res.status(400).send("Invalid data");
    }

    console.log("💬 CHAT:", user, "→", guess);

    // 🔥 ALWAYS TRACK ACTIVITY FIRST
lastMessageTime[user] = Date.now();

// reset warning immediately if active
if (warnedUsers[user]) {
    delete warnedUsers[user];
}

processGuess(user, guess);

    res.send("OK");
});

const server = http.createServer(app);
const io = new Server(server);




let lastMessageTime = {};
let warnedUsers = {};
let requiredNextRound = {}; // users who must participate next round
let participatedThisRound = {};


// 🎮 GAME STATE
let game = {
    winnerDeclared: false,
    mode: "number",
    min: 1,
    max: 100,
    answer: Math.floor(Math.random() * 100) + 1,
    word: "",
    revealed: [],
    locked: false,

    targetEmoji: "",
    spamScores: {}
};

// 🏆 DATA
let players = {};
let wheel = [];
let roundPlayers = {}; // track who already got +2 this round
let chatCount = {}; // 🔥 track messages per user


// 🧠 WORDS

// 😂 EMOJIS
const emojis = ["🔥", "💰", "🚀", "😂", "🎉", "😎"];

// 🏆 LEADERBOARD
function getLeaderboard() {
    return Object.entries(players)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((p, i) => ({
            rank: i + 1,
            user: p[0],
            points: p[1]
        }));
}

function getTopChatters() {
    return Object.entries(chatCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((p, i) => ({
            rank: i + 1,
            user: p[0],
            count: p[1]
        }));
}

// 🎡 ADD TO WHEEL
function addToWheel(user) {

    if (!wheel.includes(user)) {
        wheel.push(user);

        // 🔥 SAVE TO FILE
        fs.appendFileSync("wheel.txt", user + "\n");

        console.log("🎡 ADDED TO WHEEL:", user);
    }
}

// 🎮 NUMBER
function startNumber() {
    game.winnerDeclared = false;
    // ✅ CHECK WHO MISSED LAST ROUND
for (let user in requiredNextRound) {
    if (!participatedThisRound[user]) {
        removeFromWheel(user, "missed");
    }
}

// 🔄 RESET TRACKING FOR NEW ROUND
requiredNextRound = {};
participatedThisRound = {};
    

    game.mode = "number";

    // 🔥 GENERATE RANDOM RANGE (min 400 spread)
    let min = Math.floor(Math.random() * 600) + 1; // 1–600
    let max = min + Math.floor(Math.random() * 400) + 400; // +400 to +800

    if (max > 1000) max = 1000;

    game.min = min;
    game.max = max;

    // 🎯 ANSWER INSIDE RANGE
    game.answer = Math.floor(Math.random() * (max - min + 1)) + min;

    game.locked = false;
    roundPlayers = {};

    console.log("🎮 NUMBER MODE");
    console.log(`📊 RANGE: ${min} - ${max}`);
    console.log("🎯 ANSWER:", game.answer);

    // 🔥 SEND MODE + RANGE TO OVERLAY
    io.emit("mode", "number");
    io.emit("rangeUpdate", { min, max });
}

function getFreshWord() {

    // 📄 READ ALL WORDS
    let words = fs.readFileSync("words.txt", "utf-8")
        .split("\n")
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0);

    // 📄 LOAD USED WORDS
    let used = {};
    try {
        used = JSON.parse(fs.readFileSync("usedWords.json"));
    } catch {
        used = {};
    }

    let now = Date.now();
    let THREE_DAYS = 72 * 60 * 60 * 1000;

    // 🔥 FILTER FRESH WORDS
    let available = words.filter(word => {
        if (!used[word]) return true;

        return (now - used[word]) > THREE_DAYS;
    });

    // ⚠️ FALLBACK IF ALL USED
    if (available.length === 0) {
        console.log("⚠️ All words used. Resetting...");
        available = words;
        used = {};
    }

    // 🎯 PICK RANDOM
    let word = available[Math.floor(Math.random() * available.length)];

    // 💾 SAVE USAGE
    used[word] = now;
    fs.writeFileSync("usedWords.json", JSON.stringify(used, null, 2));

    return word;
}

// 🎮 HANGMAN
function startHangman() {
game.winnerDeclared = false;
   // ✅ CHECK WHO MISSED LAST ROUND
for (let user in requiredNextRound) {
    if (!participatedThisRound[user]) {
        removeFromWheel(user, "missed");
    }
}

// 🔄 RESET TRACKING FOR NEW ROUND
requiredNextRound = {};
participatedThisRound = {};

    game.mode = "hangman";

    game.word = getFreshWord();

    game.revealed = game.word.split("").map(c =>
        c === " " ? " " : "_"
    );

    game.locked = false;

    roundPlayers = {};

    console.log("🎮 HANGMAN MODE");
    console.log("🧠 WORD:", game.word);

    io.emit("mode", "hangman");
    io.emit("hangmanUpdate", game.revealed.join(""));
}

// 🔥 SPAM START
function startSpam() {
    game.winnerDeclared = false;

    // ✅ CHECK WHO MISSED LAST ROUND
for (let user in requiredNextRound) {
    if (!participatedThisRound[user]) {
        removeFromWheel(user, "missed");
    }
}

// 🔄 RESET TRACKING FOR NEW ROUND
requiredNextRound = {};
participatedThisRound = {};


    game.mode = "spam";
    game.locked = false;

    game.targetEmoji =
        emojis[Math.floor(Math.random() * emojis.length)];

    game.spamScores = {};

    console.log("🔥 SPAM STARTED");

    io.emit("mode", "spam");
    io.emit("spamStart", { emoji: game.targetEmoji });
}

// 🔥 SPAM END
function endSpam() {


    // 🔥 PREVENT MULTIPLE END CALLS
    if (game.mode !== "spam") return;

    game.locked = true;
    game.mode = "ended"; // 🔥 IMPORTANT

    let winner = null;
    let max = 0;

    for (let user in game.spamScores) {
        if (game.spamScores[user] > max) {
            max = game.spamScores[user];
            winner = user;
        }
    }

    if (winner) {
        players[winner] += 10;
        addToWheel(winner);
        requiredNextRound[winner] = true;
        console.log("🏆 SPAM WINNER:", winner);

        io.emit("leaderboard", getLeaderboard());
    }

    io.emit("spamEnd", {
        winner,
        leaderboard: getLeaderboard()
    });

    game.locked = false;
}

// 🎡 SHOW WHEEL
function showWheel() {
    io.emit("showWheel", { wheel });
}
function hideWheel() {
    io.emit("hideWheel");
}

// 🎡 SPIN WHEEL
function spinWheel() {

    if (wheel.length === 0) return;

    let winner = wheel[Math.floor(Math.random() * wheel.length)];

    console.log("🎯 FINAL WINNER:", winner);

    // 🔥 SEND FULL DATA FOR ANIMATION
    io.emit("spinWheel", {
        wheel,
        winner
    });
}

 // 🔥 RESET SYSTEM
    function resetGame() {

        participatedThisRound = {};

    console.log("🔥 RESETTING STREAM...");

    // 🧹 CLEAR ALL MEMORY
    players = {};
    chatCount = {};
    wheel = [];
    requiredNextRound = {};
    warnedUsers = {};
    lastMessageTime = {};
    roundPlayers = {};

    // 🎮 RESET GAME STATE
    game.locked = false;
    game.spamScores = {};
    game.mode = "number";

    // 🗂 CLEAR FILE
    try {
        fs.writeFileSync("wheel.txt", "");
    } catch (err) {
        console.log("Error clearing wheel.txt", err);
    }

    // 📡 EMIT CLEAN STATE
    io.emit("leaderboard", []);
    io.emit("topChatters", []);
    io.emit("showWheel", { wheel: [] });

    // 🔔 NOTIFY UI
    io.emit("resetGame");

    console.log("✅ RESET COMPLETE");
    }


   /* async function fetchYouTubeChat() {
    try {
        let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${LIVE_CHAT_ID}&part=snippet,authorDetails&maxResults=200&key=${YOUTUBE_API_KEY}`;

        if (nextPageToken) {
            url += `&pageToken=${nextPageToken}`;
        }

        const res = await axios.get(url);

        const messages = res.data.items;

        nextPageToken = res.data.nextPageToken;

        if (res.data.pollingIntervalMillis) {
    pollingInterval = res.data.pollingIntervalMillis;
}

        messages.forEach(msg => {

            const messageId = msg.id;

            // 🔥 SKIP DUPLICATES
            if (processedMessages.has(messageId)) return;
            processedMessages.add(messageId);

            const user = msg.authorDetails.displayName;
            const text = msg.snippet.displayMessage;

            // 🔥 SEND INTO YOUR GAME
            processGuess(user, text);

        });

    } catch (err) {
    console.log("YouTube Fetch Error:", err.message);

    // 🚨 If rate limited or blocked → slow down
    if (err.response && err.response.status === 403) {
        console.log("⚠️ Rate limited. Slowing down polling...");
        pollingInterval = 5000; // increase delay
    }

    // fallback safety
    if (!pollingInterval || pollingInterval < 2000) {
        pollingInterval = 3000;
    }
}
}*/
/*
function startYouTubePolling() {
    fetchYouTubeChat();
    setTimeout(startYouTubePolling, pollingInterval);
}*/

function processGuess(user, message) {

    if (game.locked === true) return;

         user = user || "Anonymous";

        participatedThisRound[user] = true;
        // 🔥 TRACK ACTIVITY
        

        


        let input = message.trim().toLowerCase();

        if (!players[user]) players[user] = 0;

        // 🔥 TRACK CHAT
        if (!chatCount[user]) chatCount[user] = 0;
        chatCount[user]++;

        // 🔥 FIX: UPDATE TOP CHATTERS IN REAL TIME
        io.emit("topChatters", getTopChatters());

        // 🔥 SPAM MODE
        if (game.mode === "spam") {

            players[user] += 2;

            if (requiredNextRound[user]) {
                delete requiredNextRound[user];
            }

            if (!game.spamScores[user])
                game.spamScores[user] = 0;

                game.spamScores[user]++;

                io.emit("leaderboard", getLeaderboard());
                io.emit("topChatters", getTopChatters());
                return;
             }

                // NUMBER
                if (game.mode === "number") {

                let guess = parseInt(input);

                // DO NOT return here anymore

                // ✅ ONLY NOW they are truly participating
                if (requiredNextRound[user]) {
                delete requiredNextRound[user];
                }

                // ✅ GIVE +2 ONLY ONCE PER ROUND
                if (!roundPlayers[user]) {
                players[user] += 2;
                roundPlayers[user] = true;
                io.emit("leaderboard", getLeaderboard());
                io.emit("topChatters", getTopChatters());
                }

                if (guess === game.answer && !game.winnerDeclared) {
                game.winnerDeclared = true; // 🔥 LOCK IMMEDIATELY
                handleWin(user);
                return;
                }

            
             }

             // HANGMAN
                if (game.mode === "hangman") {


                // ✅ GIVE +2 ONLY ONCE PER ROUND
                if (!roundPlayers[user]) {
                    players[user] += 2;
                    roundPlayers[user] = true;
                    io.emit("leaderboard", getLeaderboard());
                    io.emit("topChatters", getTopChatters());
                  }

                 if (input === game.word && !game.winnerDeclared) {

                        game.winnerDeclared = true;

                        if (requiredNextRound[user]) {
                            delete requiredNextRound[user];
                        }

                        handleWin(user);
                        return;
                    }

                    if (input.length === 1 && /[a-z]/.test(input)) {
                    
                    if (requiredNextRound[user]) {
                    delete requiredNextRound[user];
                }

    
            
            for (let i = 0; i < game.word.length; i++) {
                if (
                    game.word[i] === input &&
                    game.revealed[i] === "_"
                ) {
                    game.revealed[i] = input;
                }
                }

                io.emit("hangmanUpdate", game.revealed.join(""));
                }

                if (!game.revealed.includes("_") && !game.winnerDeclared) {
                game.winnerDeclared = true;
                handleWin(user);
                return;
                }
        }

}


// 🔌 SOCKET
io.on("connection", (socket) => {
socket.on("streamerChat", (data) => {
    console.log("🔥 STREAMER BOT:", data.user, "→", data.message);
    processGuess(data.user, data.message);
});
    socket.on("guess", (data) => {
    processGuess(data.user || "Anonymous", data.guess);
});

    socket.on("startNumber", startNumber);
    socket.on("startHangman", startHangman);
    socket.on("startSpam", startSpam);
    socket.on("endSpam", endSpam);
    socket.on("showWheel", showWheel);
    socket.on("spinWheel", spinWheel);
    socket.on("hideWheel", hideWheel);
    socket.on("resetGame", resetGame);


});

// 🏆 WIN
function handleWin(user) {
    game.locked = true;

    players[user] += 10;
    addToWheel(user);
    // 🔥 MUST PARTICIPATE NEXT ROUND
    requiredNextRound[user] = true;

    console.log("🏆 WINNER:", user);

    // 🔥 FIX → EMIT UPDATED LEADERBOARD IMMEDIATELY
    io.emit("leaderboard", getLeaderboard());

    io.emit("winner", {
        user,
        answer: game.mode === "hangman" ? game.word : game.answer,
        leaderboard: getLeaderboard()
    });

    
}

setInterval(() => {

    let now = Date.now();

    for (let username of [...wheel]) {

        let last = lastMessageTime[username] || 0;
        let diff = now - last;

        // ⚠️ WARNING
        if (diff > 60000 && !warnedUsers[username]) {

            warnedUsers[username] = true;

            io.emit("systemMessage",
                `⚠️ ${username} stay active or lose your spot!`);
        }

        // ❌ REMOVE
        if (diff > 90000 && wheel.includes(username)) {

            removeFromWheel(username, "inactive");
        }
    }

}, 5000);

function removeFromWheel(user, reason = "") {

    // remove from wheel array
    wheel = wheel.filter(u => u !== user);

    // remove from file
    try {
        let data = fs.readFileSync("wheel.txt", "utf-8")
            .split("\n")
            .filter(name => name.trim() !== user);

        fs.writeFileSync("wheel.txt", data.join("\n"));
    } catch {}

    // cleanup
    delete warnedUsers[user];
    delete requiredNextRound[user];

    console.log(`❌ REMOVED: ${user} (${reason})`);

    // 🔥 ANNOUNCE
    if (reason === "inactive") {
        io.emit("systemMessage",
            `❌ ${user} removed (inactive)`);
    }

    if (reason === "missed") {
        io.emit("systemMessage",
            `❌ ${user} removed (missed round)`);
    }
}

// 🚀 START
server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
//startYouTubePolling();
