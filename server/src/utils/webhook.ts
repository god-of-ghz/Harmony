export const dispatchSecurityAlert = async (type: string, message: string, ip: string) => {
    // Standardized console output for Fail2Ban compatibility
    console.warn(`[SECURITY] ${type} IP: ${ip} - ${message}`);

    const webhookUrl = process.env.ADMIN_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [{
                    title: `Security Alert: ${type}`,
                    description: message,
                    color: 0xff0000,
                    fields: [
                        { name: "IP Address", value: ip, inline: true },
                        { name: "Timestamp", value: new Date().toISOString(), inline: true }
                    ]
                }]
            })
        });
    } catch (err) {
        console.error("Failed to dispatch security webhook:", err);
    }
};
