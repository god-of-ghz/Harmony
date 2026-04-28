import { useState, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { formatBytes } from './ExportImportSection';

interface Props {
    serverUrl: string;
    onClose: () => void;
}

export interface ImportValidation {
    valid: boolean;
    guild_name?: string;
    message_count?: number;
    member_count?: number;
    file_count?: number;
    total_size?: number;
    exported_at?: string;
    source_host?: string;
    errors?: string[];
}

export const ImportModal = ({ serverUrl, onClose }: Props) => {
    const { currentAccount } = useAppStore();
    const [phase, setPhase] = useState<'select' | 'validating' | 'preview' | 'importing' | 'done' | 'error'>('select');
    const [file, setFile] = useState<File | null>(null);
    const [validation, setValidation] = useState<ImportValidation | null>(null);
    const [importProgress, setImportProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [successGuildName, setSuccessGuildName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (selectedFile: File) => {
        // Local validation: must be .zip
        if (!selectedFile.name.endsWith('.zip')) {
            setErrorMsg('Please select a valid .zip file');
            setPhase('error');
            return;
        }
        setFile(selectedFile);
        setPhase('validating');

        // Server-side validation
        try {
            const formData = new FormData();
            formData.append('bundle', selectedFile);
            const res = await fetch(`${serverUrl}/api/guilds/import/validate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` },
                body: formData
            });
            if (!res.ok) throw new Error(`Validation failed (${res.status})`);
            const data: ImportValidation = await res.json();
            setValidation(data);
            if (data.valid) {
                setPhase('preview');
            } else {
                setErrorMsg(data.errors?.join(', ') || 'Invalid bundle');
                setPhase('error');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Validation failed');
            setPhase('error');
        }
    };

    const handleImport = async () => {
        if (!file || !currentAccount?.token) return;
        setPhase('importing');
        setImportProgress(0);

        try {
            const formData = new FormData();
            formData.append('bundle', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${serverUrl}/api/guilds/import`);
            xhr.setRequestHeader('Authorization', `Bearer ${currentAccount.token}`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    setImportProgress(Math.round((e.loaded / e.total) * 80)); // 80% = upload
                }
            };

            const result = await new Promise<any>((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(JSON.parse(xhr.responseText)); }
                        catch { resolve({}); }
                    } else {
                        reject(new Error(`Import failed (${xhr.status})`));
                    }
                };
                xhr.onerror = () => reject(new Error('Network error'));
                xhr.send(formData);
            });

            setImportProgress(100);
            setSuccessGuildName(result.guild_name || validation?.guild_name || 'imported guild');
            setPhase('done');
        } catch (err: any) {
            setErrorMsg(err.message || 'Import failed');
            setPhase('error');
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'N/A';
        try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
        catch { return dateStr; }
    };

    return (
        <div data-testid="import-modal" style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10001
        }}>
            <div className="glass-panel" style={{ padding: '28px', borderRadius: '10px', maxWidth: '500px', width: '90%' }}>
                {/* File Selection */}
                {phase === 'select' && (
                    <div data-testid="import-select">
                        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📥 Import Guild Bundle
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' }}>
                            Select a Harmony export bundle (.zip) to import. The bundle will be validated before import.
                        </p>
                        <input
                            ref={fileInputRef}
                            data-testid="import-file-input"
                            type="file"
                            accept=".zip"
                            style={{ display: 'none' }}
                            onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
                        />
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="wizard-btn-nav" onClick={onClose}>Cancel</button>
                            <button
                                data-testid="import-choose-file-btn"
                                className="btn"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Choose File…
                            </button>
                        </div>
                    </div>
                )}

                {/* Validating */}
                {phase === 'validating' && (
                    <div data-testid="import-validating" style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: '32px', marginBottom: '16px', animation: 'ping-pulse 1.2s infinite' }}>📥</div>
                        <h3 style={{ marginBottom: '8px' }}>Validating…</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Checking bundle integrity</p>
                    </div>
                )}

                {/* Preview/Validation Results */}
                {phase === 'preview' && validation && (
                    <div data-testid="import-preview">
                        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📥 Import Validation
                        </h3>

                        <div style={{ padding: '12px', backgroundColor: 'rgba(35, 165, 89, 0.1)', border: '1px solid rgba(35, 165, 89, 0.3)', borderRadius: '6px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#23a559', fontWeight: 700 }}>✓</span>
                            <span style={{ color: '#23a559', fontSize: '14px' }}>Valid Harmony export bundle</span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', fontSize: '14px', marginBottom: '16px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Guild</span>
                            <strong data-testid="import-guild-name">{validation.guild_name || 'Unknown'}</strong>

                            <span style={{ color: 'var(--text-muted)' }}>Messages</span>
                            <span>{validation.message_count?.toLocaleString() || 'N/A'}</span>

                            <span style={{ color: 'var(--text-muted)' }}>Members</span>
                            <span>{validation.member_count || 'N/A'}</span>

                            <span style={{ color: 'var(--text-muted)' }}>Files</span>
                            <span>
                                {validation.file_count || 0}
                                {validation.total_size != null && ` (${formatBytes(validation.total_size)})`}
                            </span>

                            <span style={{ color: 'var(--text-muted)' }}>Exported</span>
                            <span>{formatDate(validation.exported_at)}</span>

                            <span style={{ color: 'var(--text-muted)' }}>From</span>
                            <span>{validation.source_host || 'N/A'}</span>
                        </div>

                        <div style={{ padding: '10px 14px', backgroundColor: 'rgba(250, 166, 26, 0.08)', border: '1px solid rgba(250, 166, 26, 0.25)', borderRadius: '6px', fontSize: '12px', color: '#faa61a', marginBottom: '20px' }}>
                            ⚠ You will become the owner of this guild.
                        </div>

                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="wizard-btn-nav" onClick={onClose} data-testid="import-cancel-btn">Cancel</button>
                            <button data-testid="import-confirm-btn" className="btn" onClick={handleImport}>
                                Import Guild
                            </button>
                        </div>
                    </div>
                )}

                {/* Importing Progress */}
                {phase === 'importing' && (
                    <div data-testid="import-progress" style={{ textAlign: 'center' }}>
                        <h3 style={{ marginBottom: '20px' }}>Importing Guild…</h3>

                        <div style={{ width: '100%', height: '20px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px', overflow: 'hidden', marginBottom: '12px' }}>
                            <div style={{
                                width: `${importProgress}%`, height: '100%',
                                background: 'linear-gradient(90deg, var(--brand-experiment), #4752C4)',
                                borderRadius: '10px', transition: 'width 0.3s ease'
                            }} />
                        </div>

                        <p style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>{importProgress}%</p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                            {importProgress < 80 ? 'Uploading bundle…' : 'Processing on server…'}
                        </p>
                    </div>
                )}

                {/* Done */}
                {phase === 'done' && (
                    <div data-testid="import-done" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                        <h3 style={{ marginBottom: '12px', color: '#23a559' }}>Import Complete!</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
                            <strong style={{ color: 'var(--text-normal)' }}>{successGuildName}</strong> has been imported successfully.
                        </p>
                        <button className="btn" onClick={onClose}>Close</button>
                    </div>
                )}

                {/* Error */}
                {phase === 'error' && (
                    <div data-testid="import-error">
                        <h3 style={{ marginBottom: '12px', color: '#ed4245' }}>Import Failed</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>{errorMsg}</p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="wizard-btn-nav" onClick={onClose}>Close</button>
                            <button className="btn" onClick={() => { setPhase('select'); setErrorMsg(''); }}>Try Again</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
