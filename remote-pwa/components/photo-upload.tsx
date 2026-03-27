'use client';

import { useId, useRef, useState } from 'react';

type PhotoUploadProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onError?: (message: string | null) => void;
  helperText?: string;
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function PhotoUpload({ label, value, onChange, onError, helperText }: PhotoUploadProps) {
  const pickerId = useId();
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const setError = (message: string | null) => {
    setLocalError(message);
    onError?.(message);
  };

  const readFile = (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file only.');
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image is too large. Please choose one under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      onChange(String(reader.result || ''));
    };
    reader.onerror = () => {
      setError('Could not read that image. Please try again.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="photo-upload">
      <div className="photo-upload-head">
        <label htmlFor={pickerId}>{label}</label>
        <span className="subcopy">{helperText || 'Use camera or file upload. Images only, up to 2MB.'}</span>
      </div>

      <div className="photo-upload-card">
        {value ? (
          <img className="photo-preview" src={value} alt="Selected profile" />
        ) : (
          <div className="photo-placeholder">
            <strong>No photo selected</strong>
            <span>Choose a clear face photo.</span>
          </div>
        )}

        <div className="photo-actions">
          <input
            id={pickerId}
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => readFile(event.target.files?.[0] || null)}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            hidden
            onChange={(event) => readFile(event.target.files?.[0] || null)}
          />
          <button type="button" onClick={() => cameraRef.current?.click()}>Use Camera</button>
          <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()}>Choose File</button>
          {value ? (
            <button type="button" className="ghost-button danger-button" onClick={() => { onChange(''); setError(null); }}>
              Remove Photo
            </button>
          ) : null}
        </div>
      </div>

      {localError ? <p className="notice error">{localError}</p> : null}
    </div>
  );
}
