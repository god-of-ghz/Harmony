import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';
import { ArrowLeft, Sparkles, KeyRound, Server, Search } from 'lucide-react';

export interface CreateGuildFlowProps {
    onClose: () => void;
    onBack: () => void;
    onStartSetup: (provisionCode?: string, targetNodeUrl?: string) => void;
}

interface OperatorNode {
    url: string;
    isOperator: boolean;
    checking: boolean;
}

export const CreateGuildFlow = ({ onClose, onBack, onStartSetup }: CreateGuildFlowProps) => {
    const currentAccount = useAppStore(state => state.currentAccount);
    const connectedServers = useAppStore(state => state.connectedServers);

    const [provisionCode, setProvisionCode] = useState('');
    const [codeError, setCodeError] = useState('');
    const [codeValid, setCodeValid] = useState(false);
    const [validating, setValidating] = useState(false);

    // Node picker state
    const [operatorNodes, setOperatorNodes] = useState<OperatorNode[]>([]);
    const [selectedNodeUrl, setSelectedNodeUrl] = useState<string>('');
    const [nodeSearch, setNodeSearch] = useState('');
    const [checkingNodes, setCheckingNodes] = useState(true);

    const isOperator = !!currentAccount?.is_creator;

    const getHomeNodeUrl = (): string | undefined => {
        if (currentAccount?.primary_server_url) return currentAccount.primary_server_url;
        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        return safe[0]?.url || localStorage.getItem('harmony_last_server_url') || undefined;
    };

    // Check all connected servers to see which ones the user is an operator on
    useEffect(() => {
        if (!currentAccount?.token) return;

        const safe = Array.isArray(connectedServers) ? connectedServers : [];
        if (safe.length === 0) {
            setCheckingNodes(false);
            return;
        }

        const checkNodes = async () => {
            const results: OperatorNode[] = [];

            await Promise.all(safe.map(async (server) => {
                const node: OperatorNode = { url: server.url, isOperator: false, checking: true };
                try {
                    const res = await apiFetch(`${server.url}/api/accounts/${currentAccount.id}/state`, {
                        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        // Check if user is creator on this node
                        node.isOperator = !!data.is_creator;
                    }
                } catch {
                    // Node unreachable — not operator
                }
                node.checking = false;
                results.push(node);
            }));

            setOperatorNodes(results);
            setCheckingNodes(false);

            // Auto-select if only one operator node
            const opNodes = results.filter(n => n.isOperator);
            if (opNodes.length === 1) {
                setSelectedNodeUrl(opNodes[0].url);
            } else if (opNodes.length === 0 && results.length > 0) {
                // User is not operator on any node — they'll need a provision code
                // Default to home node
                const home = getHomeNodeUrl();
                if (home) setSelectedNodeUrl(home);
            }
        };

        checkNodes();
    }, [currentAccount, connectedServers]);

    // Filter operator nodes by search
    const filteredNodes = useMemo(() => {
        const opNodes = operatorNodes.filter(n => n.isOperator);
        if (!nodeSearch.trim()) return opNodes;
        const q = nodeSearch.toLowerCase();
        return opNodes.filter(n => n.url.toLowerCase().includes(q));
    }, [operatorNodes, nodeSearch]);

    const hasMultipleOperatorNodes = operatorNodes.filter(n => n.isOperator).length > 1;
    const isOperatorOnAnyNode = operatorNodes.some(n => n.isOperator);

    // Reset validation state when code changes
    useEffect(() => {
        if (codeValid) {
            setCodeValid(false);
            setCodeError('');
        }
    }, [provisionCode]);

    const handleValidateCode = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount || !provisionCode.trim()) return;
        setCodeError('');
        setValidating(true);

        const targetNode = selectedNodeUrl || getHomeNodeUrl();
        if (!targetNode) {
            setCodeError('No connected node found.');
            setValidating(false);
            return;
        }

        try {
            const res = await apiFetch(`${targetNode}/api/provision-codes/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount.token}`
                },
                body: JSON.stringify({ code: provisionCode.trim() })
            });

            if (res.ok) {
                setCodeValid(true);
                setCodeError('');
            } else {
                setCodeValid(false);
                setCodeError('Invalid or expired provision code');
            }
        } catch (err: any) {
            console.error('Error validating provision code:', err);
            setCodeError('Network error while validating code: ' + err.message);
        } finally {
            setValidating(false);
        }
    };

    // Node picker component — shown when user is operator on multiple nodes
    const renderNodePicker = () => {
        if (checkingNodes) {
            return (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px', textAlign: 'center' }}>
                    Checking node access...
                </div>
            );
        }

        if (!hasMultipleOperatorNodes) return null;

        return (
            <div style={{ marginBottom: '16px' }}>
                <label style={{
                    fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase',
                    color: 'var(--text-muted)', marginBottom: '6px', display: 'block'
                }}>
                    Target Node
                </label>

                {/* Search input */}
                <div style={{ position: 'relative', marginBottom: '6px' }}>
                    <Search size={14} style={{
                        position: 'absolute', left: '10px', top: '50%',
                        transform: 'translateY(-50%)', color: 'var(--text-muted)'
                    }} />
                    <input
                        type="text"
                        placeholder="Search nodes..."
                        value={nodeSearch}
                        onChange={e => setNodeSearch(e.target.value)}
                        style={{
                            width: '100%', padding: '8px 10px 8px 30px', borderRadius: '4px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            backgroundColor: 'var(--bg-tertiary)', color: 'white',
                            fontSize: '13px', outline: 'none', boxSizing: 'border-box'
                        }}
                    />
                </div>

                {/* Node list */}
                <div style={{
                    maxHeight: '160px', overflowY: 'auto', display: 'flex',
                    flexDirection: 'column', gap: '4px',
                    borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.06)',
                    padding: '4px', backgroundColor: 'rgba(0, 0, 0, 0.15)'
                }}>
                    {filteredNodes.map(node => (
                        <button
                            key={node.url}
                            type="button"
                            onClick={() => setSelectedNodeUrl(node.url)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 10px', borderRadius: '4px',
                                border: selectedNodeUrl === node.url
                                    ? '1px solid var(--brand-experiment)'
                                    : '1px solid transparent',
                                backgroundColor: selectedNodeUrl === node.url
                                    ? 'rgba(88, 101, 242, 0.15)'
                                    : 'transparent',
                                color: 'var(--text-normal)', cursor: 'pointer',
                                fontSize: '13px', textAlign: 'left',
                                transition: 'all 0.15s ease',
                                width: '100%'
                            }}
                        >
                            <Server size={14} color={selectedNodeUrl === node.url ? 'var(--brand-experiment)' : 'var(--text-muted)'} />
                            <span style={{
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }}>
                                {node.url}
                            </span>
                        </button>
                    ))}
                    {filteredNodes.length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '8px', textAlign: 'center' }}>
                            No matching nodes
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="create-guild-flow">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <button
                    onClick={onBack}
                    aria-label="Back to guild options"
                    style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: '4px'
                    }}
                >
                    <ArrowLeft size={20} />
                </button>
                <h2 style={{ margin: 0 }}>Create a Guild</h2>
            </div>

            {isOperatorOnAnyNode ? (
                /* ── Operator path ── */
                <div className="create-guild-section">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '12px',
                            background: 'linear-gradient(135deg, rgba(88, 101, 242, 0.2), rgba(88, 101, 242, 0.05))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Sparkles size={20} color="var(--brand-experiment)" />
                        </div>
                        <div>
                            <p style={{ color: 'var(--text-normal)', fontSize: '14px', fontWeight: 600, margin: 0 }}>
                                Node Operator
                            </p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                                {hasMultipleOperatorNodes
                                    ? 'Select the node where you want to create a guild.'
                                    : 'You are the node operator. Create a guild directly.'}
                            </p>
                        </div>
                    </div>

                    {renderNodePicker()}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
                        <button type="button" onClick={onClose} style={{
                            flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)',
                            backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px'
                        }}>Cancel</button>
                        <button
                            className="btn"
                            data-testid="continue-setup-btn"
                            onClick={() => onStartSetup(undefined, selectedNodeUrl || getHomeNodeUrl())}
                            disabled={hasMultipleOperatorNodes && !selectedNodeUrl}
                            style={{
                                flex: 1, padding: '10px', fontWeight: 'bold',
                                opacity: (hasMultipleOperatorNodes && !selectedNodeUrl) ? 0.5 : 1
                            }}
                        >
                            Continue to Setup
                        </button>
                    </div>
                </div>
            ) : (
                /* ── Regular user (provision code) path ── */
                <div className="create-guild-section">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '12px',
                            background: 'linear-gradient(135deg, rgba(250, 166, 26, 0.2), rgba(250, 166, 26, 0.05))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <KeyRound size={20} color="#faa61a" />
                        </div>
                        <div>
                            <p style={{ color: 'var(--text-normal)', fontSize: '14px', fontWeight: 600, margin: 0 }}>
                                Provision Code Required
                            </p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                                Enter a provision code from the server operator:
                            </p>
                        </div>
                    </div>

                    {codeError && (
                        <div style={{
                            color: '#ed4245', marginBottom: '16px', fontSize: '13px', padding: '8px',
                            backgroundColor: 'rgba(237, 66, 69, 0.1)',
                            border: '1px solid rgba(237, 66, 69, 0.4)', borderRadius: '4px'
                        }}>
                            {codeError}
                        </div>
                    )}

                    {codeValid && (
                        <div style={{
                            color: '#23a559', marginBottom: '16px', fontSize: '13px', padding: '8px',
                            backgroundColor: 'rgba(35, 165, 89, 0.1)',
                            border: '1px solid rgba(35, 165, 89, 0.4)', borderRadius: '4px'
                        }}>
                            Provision code validated successfully!
                        </div>
                    )}

                    <form onSubmit={codeValid ? (e) => { e.preventDefault(); onStartSetup(provisionCode.trim(), selectedNodeUrl || getHomeNodeUrl()); } : handleValidateCode}
                          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <input
                            type="text"
                            placeholder="Enter provision code..."
                            required
                            value={provisionCode}
                            onChange={e => setProvisionCode(e.target.value)}
                            autoFocus
                            aria-label="Provision code"
                            disabled={codeValid}
                            style={{
                                padding: '10px', borderRadius: '4px', border: 'none',
                                backgroundColor: 'var(--bg-tertiary)', color: 'white',
                                opacity: codeValid ? 0.6 : 1
                            }}
                        />

                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button type="button" onClick={onClose} style={{
                                flex: 1, padding: '10px', border: '1px solid var(--background-modifier-accent)',
                                backgroundColor: 'transparent', color: 'white', cursor: 'pointer', borderRadius: '4px'
                            }}>Cancel</button>

                            {codeValid ? (
                                <button
                                    type="submit"
                                    className="btn"
                                    data-testid="continue-setup-btn"
                                    style={{ flex: 1, padding: '10px', fontWeight: 'bold' }}
                                >
                                    Continue to Setup
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    className="btn"
                                    disabled={validating}
                                    style={{ flex: 1, padding: '10px', fontWeight: 'bold', opacity: validating ? 0.7 : 1 }}
                                >
                                    {validating ? 'Validating...' : 'Validate'}
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};
