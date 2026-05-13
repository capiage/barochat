const admin = require('firebase-admin');
const serviceAccount = require('./babjeu-85d3e-firebase-adminsdk-fbsvc-0421569a66.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function discover() {
  console.log("=== Firebase Data Discovery ===");

  // Check Auth Users
  console.log("\n1. Checking Auth Users...");
  try {
    const listUsersResult = await admin.auth().listUsers(10);
    console.log(`Found ${listUsersResult.users.length} users (showing first 10):`);
    listUsersResult.users.forEach(userRecord => {
      console.log(`- ${userRecord.uid} : ${userRecord.email || userRecord.displayName || 'No email/name'}`);
    });
  } catch (e) {
    console.log("Error accessing Auth:", e.message);
  }

  // Check Firestore specific collections directly
  console.log("\n2. Checking Firestore Collections...");
  const db = admin.firestore();
  const possibleCollections = ['users', 'servers', 'messages', 'dms', 'accounts', 'presence', 'signaling', 'channels'];
  for (const col of possibleCollections) {
    try {
      const snap = await db.collection(col).limit(1).get();
      if (!snap.empty) {
        console.log(`- /${col} EXISTS`);
      }
    } catch (e) {
       console.log(`- /${col} Error: ${e.message}`);
    }
  }

}

discover().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });