import { useState, useEffect } from 'react';
import { computeFingerprint } from '../utils/crypto';

interface Props {
    publicKey?: string | null;
    style?: React.CSSProperties;
}

export const UserFingerprint = ({ publicKey, style }: Props) => {
    const [fingerprint, setFingerprint] = useState<string>('');

    useEffect(() => {
        if (!publicKey) {
            setFingerprint('');
            return;
        }
        computeFingerprint(publicKey)
            .then(fp => setFingerprint(fp))
            .catch(() => setFingerprint(''));
    }, [publicKey]);

    if (!fingerprint) return null;

    return (
        <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--background-modifier-accent)',
            padding: '2px 4px',
            borderRadius: '4px',
            marginLeft: '6px',
            fontFamily: 'monospace',
            ...style
        }}>
            {fingerprint}
        </span>
    );
};
