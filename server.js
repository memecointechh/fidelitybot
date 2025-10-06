require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const API_BASE = process.env.API_BASE;
const token = process.env.TELEGRAM_BOT_TOKEN;

// Plan name in your DB
const TELEGRAM_PLAN_NAME = "TELEGRAM-9-DAY-PLAN";

// Initialize bot with webhook mode
const bot = new TelegramBot(token, { webHook: true });

// Express app
const app = express();
app.use(bodyParser.json());

// Set webhook URL (replace `your-app` with your Fly.io app name)
const WEBHOOK_URL = `https://fidelitybots.fly.dev/webhook/${token}`;
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
                ["📊 My Investments", "🚪 Logout"]
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
              ["📊 My Investments", "🚪 Logout"]
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

      bot.sendMessage(
  chatId,
  `✅ ${res.data.message}\n\n📌 Send your payment to:\n` +
  `BTC: \`bc1qpwjgneqczaspsqmpfyr2d48wmmnvr6qn3fmm56\`\n` +
  `ETH: \`0x6c1539A2253777d9E5dBb3EEb4Eeec4F730fFAAd\`\n` +
  `USDT (TRC20): \`TGQginp7dQg3DsHCdQJjo7xeqzbsZ5uK5D\`\n` +
  `USDT (BEP20): \`0x6c1539A2253777d9E5dBb3EEb4Eeec4F730fFAAd\`\n` +
  `USDT (ERC20): \`0x6c1539A2253777d9E5dBb3EEb4Eeec4F730fFAAd\`\n\n` +
  `After payment, send screenshot to @FLTSupport for verification.`,
  { parse_mode: "Markdown" }
);


      delete sessions[chatId].selectedTier;
    } catch (error) {
      bot.sendMessage(chatId, "❌ Deposit failed: " + (error.response?.data?.message || "Server error"));
    }
  }


  //
//
// WITHDRAWAL
//
else if (text === "💸 Withdraw") {
  const session = sessions[chatId];
  if (!session?.email) {
    bot.sendMessage(chatId, "❌ You must login first using 🔐 Login.");
    return;
  }

  // Just show support instructions
  bot.sendMessage(
    chatId,
    `💸 To withdraw your funds, please contact our support team for clearance and a withdrawal code:\n\n👉 @FLTSupport`,
    { parse_mode: "Markdown" }
  );
}



// VIEW ACTIVE INVESTMENTS
//
else if (text === "📊 My Investments") {
  const email = sessions[chatId]?.email;

  if (!email) {
    return bot.sendMessage(chatId, "⚠️ Please log in first to view your active investments.");
  }

  try {
    // Call the /api/assets endpoint
    const res = await axios.post(`${API_BASE_URL}/assets`, { email });
    const deposits = res.data.deposits || [];

    if (deposits.length === 0) {
      return bot.sendMessage(chatId, "📭 You currently have no active investments.");
    }

    let message = "📊 *Your Active Investments:*\n\n";
    deposits.forEach((dep, i) => {
      const expectedReturn = parseFloat(dep.amount) + parseFloat(dep.interest || 0);

      // Calculate days remaining
      const endDate = new Date(dep.investment_end_date);
      const now = new Date();
      const diffTime = endDate - now;
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Format message
      message += `#${i + 1}\n`;
      message += `📈 Plan: *${dep.plan_name}*\n`;
      message += `💰 Invested: $${dep.amount}\n`;
      message += `💵 Expected Return: $${expectedReturn}\n`;
      message += `🗓 Ends On: ${dep.investment_end_date}\n`;

      if (daysLeft > 0) {
        message += `⏳ *${daysLeft} day${daysLeft > 1 ? "s" : ""} remaining*\n\n`;
      } else {
        message += `✅ *Completed*\n\n`;
      }
    });

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("Error fetching investments:", error);
    bot.sendMessage(chatId, "❌ Could not fetch your active investments. Please try again later.");
  }
}



  //
// LOGOUT
//
else if (text === "🚪 Logout") {
  if (sessions[chatId]?.email) {
    delete sessions[chatId];

    bot.sendMessage(chatId, "✅ You have been logged out successfully.\n\nPlease log in or sign up to continue:", {
      reply_markup: {
        keyboard: [
          ["🔐 Login", "📝 Signup"]
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  } else {
    bot.sendMessage(chatId, "ℹ️ You are not logged in.\n\nPlease log in or sign up to continue:", {
      reply_markup: {
        keyboard: [
          ["🔐 Login", "📝 Signup"]
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  }
}



  //
  // UNKNOWN COMMANDS
  //
  else if (!["/start", "🔐 Login", "📝 Signup", "💰 View Plans", "📈 My Balance", "➕ Invest", "💸 Withdraw", "📊 My Investments", "🚪 Logout"].includes(text)) {
    bot.sendMessage(chatId, "🤖 I don’t understand that. Please choose an option from the menu.");
  }
});

//
// 🔹 START EXPRESS SERVER
//
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});



























// require("dotenv").config();
// const TelegramBot = require("node-telegram-bot-api");
// const axios = require("axios");

// const API_BASE = process.env.API_BASE;
// const token = process.env.TELEGRAM_BOT_TOKEN;

// // Plan name in your DB
// const TELEGRAM_PLAN_NAME = "Telegram-9-Day-Plan";

// // Initialize bot in polling mode (local dev)
// const bot = new TelegramBot(token, { polling: true });

// // In-memory session store
// const sessions = {};

// // Investment Tiers
// const investmentTiers = [
//   { name: "Plan 1", min: 2500, max: 12900, description: "Invest between $2,500 and $12,900. Duration: 9 days." },
//   { name: "Plan 2", min: 4000, max: 20400, description: "Invest between $4,000 and $20,400. Duration: 9 days." },
//   { name: "Plan 3", min: 8500, max: 42900, description: "Invest between $8,500 and $42,900. Duration: 9 days." },
//   { name: "Plan 4", min: 12000, max: 61000, description: "Invest between $12,000 and $61,000. Duration: 9 days." },
// ];

// //
// // 🔹 START COMMAND
// //
// bot.onText(/\/start/, (msg) => {
//   const chatId = msg.chat.id;
//   bot.sendMessage(chatId, "📊 Welcome to FLT Investments!\nChoose an option:", {
//     reply_markup: {
//       keyboard: [
//         ["🔐 Login", "📝 Signup"]
//       ],
//       resize_keyboard: true,
//       one_time_keyboard: false,
//     },
//   });
// });

// //
// // 🔹 MESSAGE HANDLER
// //
// bot.on("message", async (msg) => {
//   const chatId = msg.chat.id;
//   const text = msg.text;

//   //
//   // SIGNUP FLOW
//   //
//   if (text === "📝 Signup") {
//     sessions[chatId] = { step: "signup_fullname" };
//     bot.sendMessage(chatId, "Enter your full name:");
//   }
//   else if (sessions[chatId]?.step === "signup_fullname") {
//     sessions[chatId].fullName = text;
//     sessions[chatId].step = "signup_email";
//     bot.sendMessage(chatId, "Enter your email:");
//   }
//   else if (sessions[chatId]?.step === "signup_email") {
//     sessions[chatId].email = text;
//     sessions[chatId].step = "signup_username";
//     bot.sendMessage(chatId, "Choose a username:");
//   }
//   else if (sessions[chatId]?.step === "signup_username") {
//     sessions[chatId].username = text;
//     sessions[chatId].step = "signup_password";
//     bot.sendMessage(chatId, "Enter a password:");
//   }
//   else if (sessions[chatId]?.step === "signup_password") {
//     sessions[chatId].password = text;
//     try {
//       const res = await axios.post(`${API_BASE}/signup`, {
//         fullName: sessions[chatId].fullName,
//         email: sessions[chatId].email,
//         username: sessions[chatId].username,
//         password: sessions[chatId].password,
//         referrer: null
//       });

//       bot.sendMessage(chatId, "✅ Signup successful!\n\n📩 Check your email for the 6-digit OTP code and type it here to verify your account.");
//       sessions[chatId].step = "verify_otp";
//     } catch (error) {
//       bot.sendMessage(chatId, "❌ Signup failed: " + (error.response?.data?.message || "Server error"));
//       delete sessions[chatId];
//     }
//   }
//   else if (sessions[chatId]?.step === "verify_otp") {
//     const otp = text;
//     const email = sessions[chatId].email;
//     const password = sessions[chatId].password;

//     try {
//       const verifyRes = await axios.post(`${API_BASE}/verify-otp`, { email, otp });

//       if (!verifyRes.data.success) {
//         return bot.sendMessage(chatId, "❌ Invalid OTP. Try again:");
//       }

//       const loginRes = await axios.post(`${API_BASE}/login`, { email, password });

//       if (loginRes.data.success) {
//         sessions[chatId] = {
//           email,
//           token: loginRes.data.token,
//           loggedIn: true
//         };

//         bot.sendMessage(chatId,
//           "🎉 Your email has been verified & you are now logged in!\n\nWelcome to your dashboard.",
//           {
//             reply_markup: {
//               keyboard: [
//                 ["💰 View Plans", "📈 My Balance"],
//                 ["➕ Invest", "💸 Withdraw"],
//                 ["🚪 Logout"]
//               ],
//               resize_keyboard: true
//             }
//           }
//         );
//       } else {
//         bot.sendMessage(chatId, "❌ Login failed: " + loginRes.data.message);
//       }
//     } catch (error) {
//       bot.sendMessage(chatId, "❌ Verification/Login failed: " + (error.response?.data?.message || "Server error"));
//     }
//   }

//   //
//   // LOGIN
//   //
//   else if (text === "🔐 Login") {
//     sessions[chatId] = { awaitingLogin: true };
//     bot.sendMessage(chatId, "Enter your login details:\n`Email | Password`", { parse_mode: "Markdown" });
//   }
//   else if (sessions[chatId]?.awaitingLogin && text.includes("|")) {
//     const [email, password] = text.split("|").map(s => s.trim());
//     try {
//       const res = await axios.post(`${API_BASE}/login`, { email, password });
//       if (res.data.success) {
//         sessions[chatId] = { email, token: res.data.token, loggedIn: true };

//         bot.sendMessage(chatId, "✅ " + res.data.message, {
//           reply_markup: {
//             keyboard: [
//               ["💰 View Plans", "📈 My Balance"],
//               ["➕ Invest", "💸 Withdraw"],
//               ["🚪 Logout"]
//             ],
//             resize_keyboard: true,
//             one_time_keyboard: false
//           }
//         });
//       } else {
//         bot.sendMessage(chatId, "❌ " + res.data.message);
//       }
//     } catch (error) {
//       bot.sendMessage(chatId, "❌ Login failed: " + (error.response?.data?.message || "Server error"));
//     }
//   }

//   //
//   // BALANCE
//   //
//   else if (text === "📈 My Balance") {
//     const session = sessions[chatId];
//     if (!session?.email) {
//       bot.sendMessage(chatId, "❌ You must login first using 🔐 Login.");
//       return;
//     }
//     try {
//       const res = await axios.get(`${API_BASE}/getBalance?email=${session.email}`);
//       bot.sendMessage(chatId, `💰 Your balance is: ₦${res.data.balance || 0}`);
//     } catch (error) {
//       bot.sendMessage(chatId, "❌ Failed to fetch balance.");
//     }
//   }

//   //
//   // VIEW PLANS
//   //
//   else if (text === "💰 View Plans" || text === "➕ Invest") {
//     let message = "📊 Investment Plans (All expire in 9 days):\n\n";
//     investmentTiers.forEach((tier, i) => {
//       message += `${i + 1}. ${tier.name}\n   Min: $${tier.min}\n   Max: $${tier.max}\n\n`;
//     });

//     bot.sendMessage(chatId, message + "Select a plan by typing its number (e.g. 1, 2, 3...)");
//   }

//   //
//   // PLAN SELECTION
//   //
//   else if (/^[1-4]$/.test(text)) {
//     const tier = investmentTiers[parseInt(text) - 1];
//     if (!tier) return;

//     sessions[chatId] = { ...sessions[chatId], selectedTier: tier };

//     bot.sendMessage(chatId,
//       `📌 *${tier.name}*\n\n${tier.description}\n\n💵 Please enter the *amount* you want to invest in this plan.`,
//       { parse_mode: "Markdown" }
//     );
//   }

//   //
//   // DEPOSIT AMOUNT
//   //
//   else if (sessions[chatId]?.selectedTier && !isNaN(text)) {
//     const tier = sessions[chatId].selectedTier;
//     const amount = parseFloat(text);

//     if (amount < tier.min || amount > tier.max) {
//       return bot.sendMessage(chatId, `❌ Invalid amount. Please enter between $${tier.min} and $${tier.max}.`);
//     }

//     try {
//       const res = await axios.post(`${API_BASE}/deposit`, {
//         email: sessions[chatId].email,
//         depositAmount: amount,
//         planName: TELEGRAM_PLAN_NAME,
//         planPrincipleReturn: true,
//         planCreditAmount: amount,
//         planDepositFee: 0,
//         planDebitAmount: amount,
//         depositMethod: "crypto"
//       });

//       bot.sendMessage(chatId,
//         `✅ ${res.data.message}\n\n📌 Send your payment to:\nBTC: \`1ABCDxyzbtcwallet\`\nUSDT (TRC20): \`TX123usdtwallet\`\n\nAfter payment, send screenshot to @FLTSupport for verification.`,
//         { parse_mode: "Markdown" }
//       );

//       delete sessions[chatId].selectedTier;
//     } catch (error) {
//       bot.sendMessage(chatId, "❌ Deposit failed: " + (error.response?.data?.message || "Server error"));
//     }
//   }

//   //
// // WITHDRAWAL
// //
// else if (text === "💸 Withdraw") {
//   const session = sessions[chatId];
//   if (!session?.email) {
//     bot.sendMessage(chatId, "❌ You must login first using 🔐 Login.");
//     return;
//   }

//   try {
//     // Get balance first
//     const res = await axios.get(`${API_BASE}/getBalance?email=${session.email}`);
//     const balance = res.data.balance || 0;

//     if (balance <= 0) {
//       return bot.sendMessage(chatId, "❌ You have no funds available for withdrawal.");
//     }

//     // Save state
//     sessions[chatId].step = "withdraw_wallet";
//     sessions[chatId].withdrawBalance = balance;

//     bot.sendMessage(
//       chatId,
//       `💸 Your available balance: *₦${balance}*\n\nPlease enter your crypto wallet address where funds will be sent:`,
//       { parse_mode: "Markdown" }
//     );
//   } catch (error) {
//     bot.sendMessage(chatId, "❌ Failed to fetch balance for withdrawal.");
//   }
// }

// //
// // HANDLE WALLET ADDRESS INPUT
// //
// else if (sessions[chatId]?.step === "withdraw_wallet") {
//   const walletAddress = text;
//   const email = sessions[chatId].email;
//   const amount = sessions[chatId].withdrawBalance;

//   try {
//     // Call your main website withdrawal route
//     const res = await axios.post(`${API_BASE}/withdraw`, {
//       email,
//       wallet: walletAddress,
//       amount
//     });

//     bot.sendMessage(
//       chatId,
//       `✅ Withdrawal request submitted!\n\n📌 Amount: *₦${amount}*\n📌 Wallet: \`${walletAddress}\`\n\nPlease contact @FLTSupport to finalize your withdrawal.`,
//       { parse_mode: "Markdown" }
//     );

//     // Clear withdraw step
//     delete sessions[chatId].step;
//     delete sessions[chatId].withdrawBalance;

//   } catch (error) {
//     bot.sendMessage(
//       chatId,
//       "❌ Withdrawal failed: " + (error.response?.data?.message || "Server error")
//     );
//   }
// }


//   //
//   // LOGOUT
//   //
//   else if (text === "🚪 Logout") {
//     if (sessions[chatId]?.email) {
//       delete sessions[chatId];
//       bot.sendMessage(chatId, "✅ You have been logged out successfully.");
//     } else {
//       bot.sendMessage(chatId, "ℹ️ You are not logged in.");
//     }
//   }

//   //
//   // UNKNOWN COMMANDS
//   //
//   else if (!["/start", "🔐 Login", "📝 Signup", "💰 View Plans", "📈 My Balance", "➕ Invest", "💸 Withdraw", "🚪 Logout"].includes(text)) {
//     bot.sendMessage(chatId, "🤖 I don’t understand that. Please choose an option from the menu.");
//   }
// });
