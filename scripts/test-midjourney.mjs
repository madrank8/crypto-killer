/**
 * Quick test: Verify APIFrame API key + submit a test /imagine job.
 * Run: node scripts/test-midjourney.mjs
 */

const APIFRAME_API_KEY = process.env.APIFRAME_API_KEY || 'e84430ec-634f-47b1-ac30-2110dfe31d6d';

async function test() {
  console.log('🔑 API Key:', APIFRAME_API_KEY.slice(0, 8) + '...');
  
  // 1. Check account info
  console.log('\n📊 Checking account...');
  try {
    const acctRes = await fetch('https://api.apiframe.pro/account', {
      method: 'GET',
      headers: { Authorization: APIFRAME_API_KEY },
    });
    if (acctRes.ok) {
      const acct = await acctRes.json();
      console.log('✅ Account:', JSON.stringify(acct, null, 2));
    } else {
      console.log('⚠️ Account check returned:', acctRes.status, await acctRes.text());
    }
  } catch (e) {
    console.log('⚠️ Account check error:', e.message);
  }

  // 2. Submit a simple /imagine job
  console.log('\n🎨 Submitting test /imagine...');
  const prompt = 'a golden bitcoin coin floating in dark space with dramatic lighting, minimal, cinematic --ar 16:9 --style raw --q 1';
  
  try {
    const res = await fetch('https://api.apiframe.ai/pro/imagine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: APIFRAME_API_KEY,
      },
      body: JSON.stringify({ prompt, mode: 'fast' }),
    });

    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.task_id) {
      console.log(`\n✅ Job submitted! Task ID: ${data.task_id}`);
      console.log('⏳ Polling for result (this takes 30-90s)...\n');

      // Poll
      const start = Date.now();
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 5000)); // 5s interval
        const elapsed = Math.round((Date.now() - start) / 1000);
        
        const fetchRes = await fetch('https://api.apiframe.pro/fetch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: APIFRAME_API_KEY,
          },
          body: JSON.stringify({ task_id: data.task_id }),
        });
        
        const result = await fetchRes.json();
        const status = result.status || 'unknown';
        console.log(`[${elapsed}s] Status: ${status}`);
        
        if (status === 'finished' || status === 'completed') {
          console.log('\n🎉 IMAGE GENERATED!');
          console.log('Full result:', JSON.stringify(result, null, 2));
          
          const url = result.task_result?.discord_image_url 
            || result.task_result?.image_url 
            || result.image_url 
            || result.task_result?.cdn_image_url;
          console.log('\n🖼️ Image URL:', url);
          return;
        }
        
        if (status === 'failed' || status === 'error') {
          console.log('❌ Generation failed:', JSON.stringify(result, null, 2));
          return;
        }
      }
      console.log('⏱️ Timed out after 150s');
    } else {
      console.log('❌ No task_id returned');
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

test();
