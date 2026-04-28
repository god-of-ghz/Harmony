import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { evalPromotionRule } from '../utils/slaTracker';

export const PromotionWizard = () => {
    const { currentAccount, connectedServers, setCurrentAccount } = useAppStore();
    const [recommendedReplica, setRecommendedReplica] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!currentAccount || dismissed) return;

        const checkSla = async () => {
            // Gather all connected server URLs
            const safe = Array.isArray(connectedServers) ? connectedServers : [];
            const replicas = safe.map(s => s.url);
            
            // Wait an event cycle to allow background pings to settle if they just fired
            await new Promise(r => setTimeout(r, 1000));
            
            // Primary is either primary_server_url or the first connected server
            const primaryUrl = currentAccount.primary_server_url || replicas[0];
            if (!primaryUrl) return;
            
            const targetReplica = evalPromotionRule(primaryUrl, replicas.filter(r => r !== primaryUrl));
            if (targetReplica) {
                setRecommendedReplica(targetReplica);
            }
        };

        checkSla();
    }, [currentAccount, connectedServers, dismissed]);

    if (!recommendedReplica || !currentAccount || dismissed) {
        return null; // Do not render
    }

    const handlePromote = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${recommendedReplica}/api/federation/promote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    delegationCert: currentAccount.delegation_cert
                })
            });

            if (res.ok) {
                // Force update current account state to make this the new primary
                setCurrentAccount({
                    ...currentAccount,
                    primary_server_url: recommendedReplica,
                    authority_role: 'primary'
                });
                setDismissed(true);
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to promote replica server');
            }
        } catch (err: any) {
            setError(err.message || 'Network error during promotion');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999,
            animation: 'fadeIn 0.3s ease-out'
        }}>
            <div className="glass-panel" style={{
                padding: '32px', borderRadius: '12px', width: '450px',
                color: 'var(--text-normal)', display: 'flex', flexDirection: 'column', gap: '16px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
                border: '1px solid var(--background-modifier-accent)'
            }}>
                <h2 style={{ margin: 0, color: 'var(--text-focus)', fontSize: '24px' }}>Network Outage Detected</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '15px', lineHeight: '1.5' }}>
                    Your Primary server appears to be experiencing long-term connectivity issues. 
                    We recommend switching to a Backup Server to restore full functionality.
                </div>
                
                <div style={{
                    backgroundColor: 'var(--bg-tertiary)', padding: '16px',
                    borderRadius: '8px', borderLeft: '4px solid #57F287'
                }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Recommended Backup</div>
                    <div style={{ fontSize: '16px', color: 'var(--text-normal)', marginTop: '4px', wordBreak: 'break-all' }}>{recommendedReplica}</div>
                </div>

                {error && (
                    <div style={{ color: '#ed4245', fontSize: '14px', backgroundColor: 'rgba(237, 66, 69, 0.1)', padding: '10px', borderRadius: '4px' }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <button 
                        onClick={() => setDismissed(true)} 
                        disabled={loading}
                        style={{
                            flex: 1, padding: '12px', border: '1px solid var(--background-modifier-accent)',
                            backgroundColor: 'transparent', color: 'var(--text-normal)', cursor: 'pointer',
                            borderRadius: '4px', fontWeight: 'bold', transition: 'background-color 0.2s'
                        }}>
                        Ignore
                    </button>
                    <button 
                        onClick={handlePromote}
                        disabled={loading}
                        className="btn"
                        style={{
                            flex: 2, padding: '12px', backgroundColor: '#5865F2', color: 'white',
                            border: 'none', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold',
                            opacity: loading ? 0.7 : 1, transition: 'background-color 0.2s'
                        }}>
                        {loading ? 'Promoting...' : 'Promote Backup to Primary'}
                    </button>
                </div>
            </div>
        </div>
    );
};
