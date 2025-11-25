# Vercel Deployment Guide

Your Express backend is now ready to deploy on Vercel!

## 📋 Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. MongoDB connection string (MongoDB Atlas or your MongoDB instance)
3. Git repository (GitHub, GitLab, or Bitbucket)

## 🚀 Deployment Steps

### 1. Push to Git Repository

Make sure your code is pushed to GitHub, GitLab, or Bitbucket:

```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Deploy to Vercel

**Option A: Via Vercel Dashboard**

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your Git repository
4. Vercel will auto-detect the configuration

**Option B: Via Vercel CLI**

```bash
npm i -g vercel
vercel login
vercel
```

### 3. Set Environment Variables

In your Vercel project settings, add these environment variables:

- `MONGO_URI` - Your MongoDB connection string
  - Example: `mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority`

### 4. Deploy

Vercel will automatically:

- Install dependencies
- Build your project
- Deploy to production

## 🔗 API Endpoints

After deployment, your API will be available at:

- `https://your-project.vercel.app/api/sensors/latest`
- `https://your-project.vercel.app/api/sensors/history?period=1h`
- All other endpoints work the same way

## ⚠️ Important Notes

### In-Memory State Limitations

The following features use in-memory variables that **won't persist** across serverless invocations:

- `commandQueue` - Commands may be lost between invocations
- `latestSensorData` - Falls back to database
- `connectionStatus` - Connection tracking resets

**Solution**: For production, consider:

- Using a database to store commands
- Using Redis or similar for state management
- Relying on database queries instead of in-memory state

### MongoDB Connection

The MongoDB connection is optimized for serverless:

- Connections are cached and reused
- Automatic reconnection handling
- Connection pooling enabled

### Local Development

Your original `server.js` still works for local development:

```bash
npm run dev
```

The server will run on `http://localhost:5000`

## 📝 Environment Variables

Create a `.env` file for local development:

```env
MONGO_URI=your_mongodb_connection_string
PORT=5000
```

**Never commit `.env` to Git!** Vercel uses environment variables from the dashboard.

## 🧪 Testing

After deployment, test your endpoints:

```bash
# Test latest sensor data
curl https://your-project.vercel.app/api/sensors/latest

# Test history endpoint
curl https://your-project.vercel.app/api/sensors/history?period=1h
```

## 🔄 Updating Your Frontend

Update your frontend API base URL:

```javascript
// Change from:
const API_URL = "http://localhost:5000";

// To:
const API_URL = "https://your-project.vercel.app";
```

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
