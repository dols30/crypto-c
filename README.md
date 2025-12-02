# Crypto-C Web3 Security Extension

## Quick Start Guide

### 1. Start the Backend Server

Open a terminal and navigate to the backend directory:

```bash
cd crypto-c/backend
```

**Choose one of these methods to start the server:**

**Method 1: Use the run script (Easiest)**
```bash
./run.sh
```

**Method 2: Use venv Python directly (No activation needed)**
```bash
./venv/bin/python main.py
```

**Method 3: Activate venv first (Traditional way)**
```bash
source venv/bin/activate
python main.py
```

You should see:
```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Keep this terminal open!** The server needs to keep running.

### 2. Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `crypto-c/extension` folder

### 3. Test the Connection

1. **Test Backend API:**
   - Open browser and go to: `http://localhost:8000/docs`
   - You should see the FastAPI interactive documentation

2. **Test Extension:**
   - Click the Crypto-C extension icon in Chrome toolbar
   - The popup should show the current site's risk score
   - Navigate to a normal site (e.g., google.com) - should show low risk
   - Navigate to a test URL with "malicious" in it - should show high risk

### 4. Verify Backend Connection

Open Chrome DevTools (F12) → Console tab. When you navigate to a new page, you should see:
- `"Analyzing URL: ..."` messages
- If backend is connected: API calls to `localhost:8000`
- If backend is not running: `"Backend not available, using mock mode"`

## API Endpoints

- `GET /` - Health check
- `POST /api/analyze-url` - Phishing detection
- `POST /api/simulate` - Transaction simulation

## Troubleshooting

**Backend won't start:**
- Make sure you're in the `crypto-c/backend` directory
- Try using `./run.sh` or `./venv/bin/python main.py` (no activation needed)
- If using `source venv/bin/activate`, make sure you use `source` (not `./venv/bin/activate`)
- Check if port 8000 is already in use: `lsof -i :8000`

**Extension can't connect:**
- Make sure backend is running (check terminal)
- Open `http://localhost:8000` in browser - should show JSON response
- Check Chrome console for errors

**Extension shows "Err" for risk score:**
- Backend is not running or not accessible
- Extension will fall back to mock mode automatically

## Features

✅ Real-time URL phishing detection
✅ Transaction interception
✅ Risk scoring visualization
✅ Approval management UI
✅ Warning overlays for malicious sites

