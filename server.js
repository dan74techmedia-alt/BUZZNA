// ====================================================================
// LOGICLOOM SECURE BACKEND CORE ENGINE
// CORE STACK: Node.js + Express + Neon PostgreSQL + Gemini 1.5 Flash
// ====================================================================

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
// FIX: Import the standard GoogleGenerativeAI helper class directly
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Serve static frontend files if hosted out of a public directory
app.use(express.static('public'));

// 1. DATABASE CONNECTION POOL SETUP (Neon PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Neon cloud routing connections
});

// 2. GOOGLE GEMINI 1.5 FLASH AI ROUTER INITIALIZATION
// FIX: Use GoogleGenerativeAI initialization sequence
const aiEngine = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = aiEngine.getGenerativeModel({ model: "gemini-1.5-flash" });


// ====================================================================
// API ROUTE 1: USER REGISTRATION & SUBSCRIPTION WEBHOOK SIMULATION
// ====================================================================
app.post('/api/users/register', async (req, res) => {
    const { fullName, mpesaNumber, emailAddress, selectedTier, costAmount } = req.body;

    if (!fullName || !mpesaNumber || !emailAddress || !selectedTier) {
        return res.status(400).json({ success: false, error: "Missing required identity configuration parameters." });
    }

    try {
        // Calculate subscription expiration timestamp based on pass layout selection
        let daysToAdd = 0;
        if (selectedTier === 'daily') daysToAdd = 1;
        else if (selectedTier === 'weekly') daysToAdd = 7;
        else if (selectedTier === 'monthly') daysToAdd = 30;

        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + daysToAdd);

        // Upsert User: Create new record, or overwrite subscription metrics if they are upgrading/renewing
        const queryText = `
            INSERT INTO users (full_name, mpesa_number, email_address, subscription_tier, subscription_expires_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (mpesa_number) 
            DO UPDATE SET 
                subscription_tier = EXCLUDED.subscription_tier,
                subscription_expires_at = EXCLUDED.subscription_expires_at
            RETURNING user_id, full_name, mpesa_number, subscription_tier, pending_balance;
        `;

        const dbResult = await pool.query(queryText, [fullName, mpesaNumber, emailAddress, selectedTier, expirationDate]);
        const user = dbResult.rows[0];

        return res.status(200).json({
            success: true,
            message: `STK Push Simulated Successfully for KSH ${costAmount}. Subscription activated.`,
            user: {
                userId: user.user_id,
                fullName: user.full_name,
                mpesaNumber: user.mpesa_number,
                tier: user.subscription_tier,
                balance: user.pending_balance
            }
        });

    } catch (error) {
        console.error("Database Engine Fault during Registration:", error);
        return res.status(500).json({ success: false, error: "Internal Secure Ledger database pipeline timeout." });
    }
});


// ====================================================================
// API ROUTE 2: CHALLENGE FETCH (GET TODAY'S SCENARIO)
// ====================================================================
app.get('/api/challenges/today', async (req, res) => {
    try {
        // Selects the latest challenge row inserted into the structural workspace ledger
        const dbResult = await pool.query('SELECT challenge_id, scenario_text, pro_tip_hint, minimum_word_count FROM challenges ORDER BY created_at DESC LIMIT 1');
        
        if (dbResult.rows.length === 0) {
            // Safe fallback seed data if the administrator database is clean and empty
            return res.status(200).json({
                challenge_id: 1,
                scenario_text: "A community relies on one old water well. A factory owner wants to buy the land to create 500 jobs, but the factory might risk polluting the underlying water basin. As an urban economic analyst, design a logical framework balancing community necessity and industrial job expansion.",
                pro_tip_hint: "Prioritize long-term sustainability frameworks versus immediate short-term capital deployment.",
                minimum_word_count: 50
            });
        }

        return res.status(200).json(dbResult.rows[0]);

    } catch (error) {
        console.error("Failed to query active workspace task challenge:", error);
        return res.status(500).json({ error: "Failed to download active daily workspace operational layout." });
    }
});


// ====================================================================
// API ROUTE 3: HIGH-INTEGRITY MULTI-LAYER LOGIC ANALYSIS GRADER
// ====================================================================
app.post('/api/submissions/evaluate', async (req, res) => {
    const { userId, challengeId, userResponse, switchCount, timeSpentSeconds } = req.body;

    // Direct input schema validation
    if (!userId || !challengeId || !userResponse || timeSpentSeconds === undefined) {
        return res.status(400).json({ success: false, message: "Malformed telemetry payload execution metrics rejected." });
    }

    try {
        // Fetch target challenge validation configurations from Neon repository
        const challengeQuery = await pool.query('SELECT * FROM challenges WHERE challenge_id = $1', [challengeId]);
        if (challengeQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Target logic operational framework reference ID not found." });
        }
        const challenge = challengeQuery.rows[0];

        // Fetch targeting user metrics and verify active paid access timestamp bounds
        const userQuery = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (userQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Identity credentials not registered on platform." });
        }
        const user = userQuery.rows[0];

        const numericExpiresAt = new Date(user.subscription_expires_at).getTime();
        if (numericExpiresAt < Date.now()) {
            return res.status(403).json({ success: false, message: "🔒 Access Window Closed: Your current Challenge Pass has expired. Re-verify billing layer." });
        }

        // --- LAYER 1 SECURITY VERIFICATION: WORD COUNT baselines ---
        const wordsArray = userResponse.trim().split(/\s+/).filter(w => w.length > 0);
        const actualWordCount = wordsArray.length;

        if (actualWordCount < challenge.minimum_word_count) {
            await pool.query(
                `INSERT INTO submissions (user_id, challenge_id, user_response, switch_count, time_spent_seconds, is_passed, ai_feedback_summary) 
                 VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
                [userId, challengeId, userResponse, switchCount, timeSpentSeconds, "Structural submission failed word count baseline requirement."]
            );
            return res.status(200).json({
                success: false,
                message: `Logic layout incomplete. Your entry holds ${actualWordCount} words. You must hit the baseline threshold of ${challenge.minimum_word_count} words.`
            });
        }

        // --- LAYER 2 SECURITY VERIFICATION: AUTOMATED WPM BOT DETECTION ---
        const computedMinutes = timeSpentSeconds / 60;
        const wordsPerMinute = actualWordCount / (computedMinutes || 0.01);
        if (wordsPerMinute > 160 && timeSpentSeconds < 8) {
            return res.status(403).json({
                success: false,
                message: "⚠️ AUTOMATED INTEGRITY BREACH: Character injection velocity exceeds human constraints. Evaluation aborted."
            });
        }

        // --- LAYER 3 SECURITY VERIFICATION: MANDATORY STRUCTURAL KEYWORD MATCHING ---
        const cleanPayloadText = userResponse.toLowerCase();
        const missingKeywords = [];
        
        // Handle array verification if defined, fall back to safe core array list defaults if empty
        const validationArray = challenge.mandatory_keywords || ["sustainability", "capital", "framework"];
        
        validationArray.forEach(keyword => {
            if (!cleanPayloadText.includes(keyword.toLowerCase())) {
                missingKeywords.push(keyword);
            }
        });

        if (missingKeywords.length > 0) {
            const analyticalFailureFeedback = `Logic structure missing essential thematic components. You failed to map out these critical structural vectors: [${missingKeywords.join(', ')}].`;
            
            await pool.query(
                `INSERT INTO submissions (user_id, challenge_id, user_response, switch_count, time_spent_seconds, is_passed, ai_feedback_summary) 
                 VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
                [userId, challengeId, userResponse, switchCount, timeSpentSeconds, analyticalFailureFeedback]
            );

            return res.status(200).json({ success: false, message: analyticalFailureFeedback });
        }

        // --- LAYER 4 SEMANTIC VERIFICATION: DEPLOYING GEMINI 1.5 FLASH AI ENGINE ---
        const coreSystemInstruction = `
            You are the LogicLoom Automated Assessment Matrix Engine. Evaluate this solution against the scenario.
            
            SCENARIO CONTEXT: "${challenge.scenario_text}"
            USER INPUT SOLUTION: "${userResponse}"
            TELEMETRY SWITCH INFRACTIONS DETECTED: ${switchCount}

            EVALUATION DIRECTIVES:
            1. Analyze logic execution clarity, structural viability, and internal consistency.
            2. If telemetry switch infractions are higher than 2, strictly penalize generic, robotic, or textbook phrases.
            3. Return your output clean and compliant with this absolute JSON layout structure. Do not wrap it in markdown tags or triple backticks:
            {
                "semanticScore": 85,
                "reasoningPassed": true,
                "growthModelAnswer": "State a clean two-sentence constructive insight highlighting what structural element was missing or weak."
            }
        `;

        // FIX: Call generateContent directly on the model wrapper instance
        const aiResponseNode = await model.generateContent(coreSystemInstruction);
        const cleanTextPayload = aiResponseNode.response.text().trim();
        
        // Parse the raw payload return node directly
        const gradingMatrix = JSON.parse(cleanTextPayload);

        // Compute final score metric outcome
        const logicEvaluationPassed = gradingMatrix.reasoningPassed && switchCount <= 3;
        let finalFeedbackMessage = "";

        if (logicEvaluationPassed) {
            finalFeedbackMessage = "Scenario Solved Successfully! Verification confirmed, +KES 22.00 ledger balance allocation logged.";
            
            // 1. Log absolute pass state configuration entry into the database
            await pool.query(
                `INSERT INTO submissions (user_id, challenge_id, user_response, switch_count, time_spent_seconds, is_passed, ai_feedback_summary) 
                 VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
                [userId, challengeId, userResponse, switchCount, timeSpentSeconds, gradingMatrix.growthModelAnswer]
            );

            // 2. Safely increment the user's live physical server wallet ledger balance metric
            await pool.query(
                'UPDATE users SET pending_balance = pending_balance + 22.00 WHERE user_id = $1',
                [userId]
            );

            // Fetch absolute latest live synchronized balance data string
            const updatedWallet = await pool.query('SELECT pending_balance FROM users WHERE user_id = $1', [userId]);

            return res.status(200).json({
                success: true,
                message: finalFeedbackMessage,
                newBalance: updatedWallet.rows[0].pending_balance,
                insights: gradingMatrix.growthModelAnswer
            });

        } else {
            finalFeedbackMessage = `Logic Layout Incomplete. Solution structural correction: ${gradingMatrix.growthModelAnswer} ${switchCount > 3 ? '(Flagged due to abnormal browser view swapping activity).' : ''}`;
            
            await pool.query(
                `INSERT INTO submissions (user_id, challenge_id, user_response, switch_count, time_spent_seconds, is_passed, ai_feedback_summary) 
                 VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
                [userId, challengeId, userResponse, switchCount, timeSpentSeconds, finalFeedbackMessage]
            );

            return res.status(200).json({
                success: false,
                message: finalFeedbackMessage
            });
        }

    } catch (error) {
        console.error("Critical Runtime System Engine Error during logic analysis evaluation:", error);
        return res.status(500).json({ success: false, message: "Core AI analysis pipeline routing failure. Please execute submission again." });
    }
});


// ====================================================================
// CORE BACKEND INITIALIZATION PORTS
// ====================================================================
const BACKEND_PORT = process.env.PORT || 5000;
app.listen(BACKEND_PORT, () => {
    console.log(`=== LOGICLOOM SECURITY BACKEND RUNNING ON PORT ${BACKEND_PORT} ===`);
});
