// Test script to check if Cloudflare Worker is updated
const fs = require('fs');

async function testWorker() {
  try {
    console.log('Testing Cloudflare Worker...');
    
    // Test 1: Health check
    const healthRes = await fetch('https://notion-tasks-webhook-relay.bdicksmusic.workers.dev/health');
    const health = await healthRes.json();
    console.log('Health:', health);
    
    // Test 2: Register a new user
    const registerRes = await fetch('https://notion-tasks-webhook-relay.bdicksmusic.workers.dev/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'test-script' })
    });
    const registerData = await registerRes.json();
    console.log('Register response:', registerData);
    console.log('Has verifyUrl field:', 'verifyUrl' in registerData);
    
    // Test 3: Check if user was actually created in KV
    const userId = registerData.userId;
    console.log('Checking user:', userId);
    
    // Wait a moment for KV propagation
    await new Promise(r => setTimeout(r, 1000));
    
    const debugRes = await fetch(`https://notion-tasks-webhook-relay.bdicksmusic.workers.dev/debug/${userId}`);
    const debugData = await debugRes.json();
    console.log('Debug response:', debugData);
    
    if (debugData.error) {
      console.log('❌ User NOT found in KV - deployment issue!');
    } else {
      console.log('✅ User found in KV - deployment working!');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testWorker();

