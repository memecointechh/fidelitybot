require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const API_BASE = process.env.API_BASE;
const token = process.env.TELEGRAM_BOT_TOKEN;

// Plan name in your DB
const TELEGRAM_PLAN_NAME = "Telegram-9-Day-Plan";

// Initialize bot with webhook mode
const bot = new TelegramBot(token, { webHook: true });

// Express app
const app = express();
app.use(bodyParser.json());

// Set webhook URL (replace `your-app` with your Fly.io app name)
const WEBHOOK_URL = `https://your-app.fly.dev/webhook/${token}`;
bot.setWebHook(WEBHOOK_URL);

// Route to receive Telegram updates
app.post(`/webhook/${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Root route (just to check server is running)
app.get("/", (req, res) => {
  res.send("Telegram bot is running ✅");
});

// In-memory session store
const sessions = {};

// Investment Tiers
const investmentTiers = [
  { name: "Plan 1", min: 2500, max: 12900, description: "Invest between $2,500 and $12,900. Duration: 9 days." },
  { name: "Plan 2", min: 4000, max: 20400, description: "Invest between $4,000 and $20,400. Duration: 9 days." },
  { name: "Plan 3", min: 8500, max: 42900, description: "Invest between $8,500 and $42,900. Duration: 9 days." },
  { name: "Plan 4", min: 12000, max: 61000, description: "Invest between $12,000 and $61,000. Duration: 9 days." },
];

//
// 🔹 START COMMAND
//
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📊 Welcome to FLT Investments!\nChoose an option:", {
    reply_markup: {
      keyboard: [
        ["🔐 Login", "📝 Signup"]
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  });
});

//
// 🔹 MESSAGE HANDLER
//
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  //
  // SIGNUP FLOW
  //
  if (text === "📝 Signup") {
    sessions[chatId] = { step: "signup_fullname" };
    bot.sendMessage(chatId, "Enter your full name:");
  }
  else if (sessions[chatId]?.step === "signup_fullname") {
    sessions[chatId].fullName = text;
    sessions[chatId].step = "signup_email";
    bot.sendMessage(chatId, "Enter your email:");
  }
  else if (sessions[chatId]?.step === "signup_email") {
    sessions[chatId].email = text;
    sessions[chatId].step = "signup_username";
    bot.sendMessage(chatId, "Choose a username:");
  }
  else if (sessions[chatId]?.step === "signup_username") {
    sessions[chatId].username = text;
    sessions[chatId].step = "signup_password";
    bot.sendMessage(chatId, "Enter a password:");
  }
  else if (sessions[chatId]?.step === "signup_password") {
    sessions[chatId].password = text;
    try {
      const res = await axios.post(`${API_BASE}/signup`, {
        fullName: sessions[chatId].fullName,
        email: sessions[chatId].email,
        username: sessions[chatId].username,
        password: sessions[chatId].password,
        referrer: null
      });

      bot.sendMessage(chatId, "✅ Signup successful!\n\n📩 Check your email for the 6-digit OTP code and type it here to verify your account.");
      sessions[chatId].step = "verify_otp";
    } catch (error) {
      bot.sendMessage(chatId, "❌ Signup failed: " + (error.response?.data?.message || "Server error"));
      delete sessions[chatId];
    }
  }
  else if (sessions[chatId]?.step === "verify_otp") {
    const otp = text;
    const email = sessions[chatId].email;
    const password = sessions[chatId].password;

    try {
      const verifyRes = await axios.post(`${API_BASE}/verify-otp`, { email, otp });

      if (!verifyRes.data.success) {
        return bot.sendMessage(chatId, "❌ Invalid OTP. Try again:");
      }

      const loginRes = await axios.post(`${API_BASE}/login`, { email, password });

      if (loginRes.data.success) {
        sessions[chatId] = {
          email,
          token: loginRes.data.token,
          loggedIn: true
        };

        bot.sendMessage(chatId,
          "🎉 Your email has been verified & you are now logged in!\n\nWelcome to your dashboard.",
          {
            reply_markup: {
              keyboard: [
                ["💰 View Plans", "📈 My Balance"],
                ["➕ Invest", "💸 Withdraw"],
                ["🚪 Logout"]
              ],
              resize_keyboard: true
            }
          }
        );
      } else {
        bot.sendMessage(chatId, "❌ Login failed: " + loginRes.data.message);
      }
    } catch (error) {
      bot.sendMessage(chatId, "❌ Verification/Login failed: " + (error.response?.data?.message || "Server error"));
    }
  }

  //
  // LOGIN
  //
  else if (text === "🔐 Login") {
    sessions[chatId] = { awaitingLogin: true };
    bot.sendMessage(chatId, "Enter your login details:\n`Email | Password`", { parse_mode: "Markdown" });
  }
  else if (sessions[chatId]?.awaitingLogin && text.includes("|")) {
    const [email, password] = text.split("|").map(s => s.trim());
    try {
      const res = await axios.post(`${API_BASE}/login`, { email, password });
      if (res.data.success) {
        sessions[chatId] = { email, token: res.data.token, loggedIn: true };

        bot.sendMessage(chatId, "✅ " + res.data.message, {
          reply_markup: {
            keyboard: [
              ["💰 View Plans", "📈 My Balance"],
              ["➕ Invest", "💸 Withdraw"],
              ["🚪 Logout"]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          }
        });
      } else {
        bot.sendMessage(chatId, "❌ " + res.data.message);
      }
    } catch (error) {
      bot.sendMessage(chatId, "❌ Login failed: " + (error.response?.data?.message || "Server error"));
    }
  }

  //
  // BALANCE
  //
  else if (text === "📈 My Balance") {
    const session = sessions[chatId];
    if (!session?.email) {
      bot.sendMessage(chatId, "❌ You must login first using 🔐 Login.");
      return;
    }
    try {
      const res = await axios.get(`${API_BASE}/getBalance?email=${session.email}`);
      bot.sendMessage(chatId, `💰 Your balance is: ₦${res.data.balance || 0}`);
    } catch (error) {
      bot.sendMessage(chatId, "❌ Failed to fetch balance.");
    }
  }

  //
  // VIEW PLANS
  //
  else if (text === "💰 View Plans" || text === "➕ Invest") {
    let message = "📊 Investment Plans (All expire in 9 days):\n\n";
    investmentTiers.forEach((tier, i) => {
      message += `${i + 1}. ${tier.name}\n   Min: $${tier.min}\n   Max: $${tier.max}\n\n`;
    });

    bot.sendMessage(chatId, message + "Select a plan by typing its number (e.g. 1, 2, 3...)");
  }

  //
  // PLAN SELECTION
  //
  else if (/^[1-4]$/.test(text)) {
    const tier = investmentTiers[parseInt(text) - 1];
    if (!tier) return;

    sessions[chatId] = { ...sessions[chatId], selectedTier: tier };

    bot.sendMessage(chatId,
      `📌 *${tier.name}*\n\n${tier.description}\n\n💵 Please enter the *amount* you want to invest in this plan.`,
      { parse_mode: "Markdown" }
    );
  }

  //
  // DEPOSIT AMOUNT
  //
  else if (sessions[chatId]?.selectedTier && !isNaN(text)) {
    const tier = sessions[chatId].selectedTier;
    const amount = parseFloat(text);

    if (amount < tier.min || amount > tier.max) {
      return bot.sendMessage(chatId, `❌ Invalid amount. Please enter between $${tier.min} and $${tier.max}.`);
    }

    try {
      const res = await axios.post(`${API_BASE}/deposit`, {
        email: sessions[chatId].email,
        depositAmount: amount,
        planName: TELEGRAM_PLAN_NAME,
        planPrincipleReturn: true,
        planCreditAmount: amount,
        planDepositFee: 0,
        planDebitAmount: amount,
        depositMethod: "crypto"
      });

      bot.sendMessage(chatId,
        `✅ ${res.data.message}\n\n📌 Send your payment to:\nBTC: \`1ABCDxyzbtcwallet\`\nUSDT (TRC20): \`TX123usdtwallet\`\n\nAfter payment, send screenshot to @FLTSupport for verification.`,
        { parse_mode: "Markdown" }
      );

      delete sessions[chatId].selectedTier;
    } catch (error) {
      bot.sendMessage(chatId, "❌ Deposit failed: " + (error.response?.data?.message || "Server error"));
    }
  }

  //
  // LOGOUT
  //
  else if (text === "🚪 Logout") {
    if (sessions[chatId]?.email) {
      delete sessions[chatId];
      bot.sendMessage(chatId, "✅ You have been logged out successfully.");
    } else {
      bot.sendMessage(chatId, "ℹ️ You are not logged in.");
    }
  }

  //
  // UNKNOWN COMMANDS
  //
  else if (!["/start", "🔐 Login", "📝 Signup", "💰 View Plans", "📈 My Balance", "➕ Invest", "💸 Withdraw", "🚪 Logout"].includes(text)) {
    bot.sendMessage(chatId, "🤖 I don’t understand that. Please choose an option from the menu.");
  }
});

//
// 🔹 START EXPRESS SERVER
//
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
