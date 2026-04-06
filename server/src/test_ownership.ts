const BASE_URL = 'http://localhost:3001';

async function testOwnership() {
    try {
        console.log("Checking if owner exists...");
        const res1 = await fetch(`${BASE_URL}/api/accounts/owner-exists`);
        const data1: any = await res1.json();
        console.log("Owner exists:", data1.exists);

        if (!data1.exists) {
            console.log("Creating owner account via signup...");
            const signupPayload = {
                email: `owner-${Date.now()}@test.com`,
                serverAuthKey: "test-auth-key",
                public_key: "test-pub-key",
                encrypted_private_key: "test-enc-key",
                key_salt: "test-salt",
                key_iv: "test-iv",
                claimOwnership: true
            };
            const res2 = await fetch(`${BASE_URL}/api/accounts/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signupPayload)
            });
            const data2: any = await res2.json();
            console.log("Signup response:", data2);

            console.log("Verifying owner status...");
            const res3 = await fetch(`${BASE_URL}/api/accounts/owner-exists`);
            const data3: any = await res3.json();
            console.log("Owner exists after signup:", data3.exists);
        } else {
            console.log("Owner already exists. Testing signup with claimOwnership=true (should ignore or fail safely)...");
            const signupPayload = {
                email: `non-owner-${Date.now()}@test.com`,
                serverAuthKey: "test-auth-key",
                public_key: "test-pub-key",
                encrypted_private_key: "test-enc-key",
                key_salt: "test-salt",
                key_iv: "test-iv",
                claimOwnership: true
            };
            const res4 = await fetch(`${BASE_URL}/api/accounts/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signupPayload)
            });
            const data4: any = await res4.json();
            console.log("Signup response (should not be creator):", data4);
            
            if (data4.is_creator) {
                console.error("FAIL: Second user became creator!");
            } else {
                console.log("SUCCESS: Second user is NOT creator.");
            }
        }
    } catch (err: any) {
        console.error("Test failed:", err.message);
    }
}

testOwnership();
