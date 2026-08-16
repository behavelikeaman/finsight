"use client";

/**
 * 파일 드롭/선택. 드롭 시점에만 ensureSession()을 호출한다 — 랜딩 방문만으로는
 * 호출하지 않는다. 여기서 호출하지 않으면 구경꾼·크롤러까지 auth.users 행을
 * 만든다.
 */
import { useCallback, useRef, useState } from "react";

import { detectSourceKind, ingestFile } from "@/lib/ingest";
import { ensureSession } from "@/lib/supabase/auth";
import type { RawTable, SourceKind } from "@/types/domain";

export interface IngestedFile {
  table: RawTable;
  sourceKind: SourceKind;
  fileName: string;
  isAnonymous: boolean;
}

interface DropZoneProps {
  onIngested: (result: IngestedFile) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const ACCEPT = ".csv,.xlsx";

export function DropZone({ onIngested, onError, disabled }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      try {
        const session = await ensureSession();
        const buffer = await file.arrayBuffer();
        const sourceKind = detectSourceKind(file.name);
        const { table } = await ingestFile(buffer, file.name);
        onIngested({
          table,
          sourceKind,
          fileName: file.name,
          isAnonymous: session.isAnonymous,
        });
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : "파일을 읽는 중 오류가 발생했습니다.",
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [onIngested, onError],
  );

  const busy = disabled === true || isProcessing;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!busy && (e.key === "Enter" || e.key === " ")) {
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) void handleFile(file);
      }}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-8 py-16 text-center transition-colors ${
        isDragging ? "border-primary bg-primary/5" : "border-hairline"
      } ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <p className="text-base font-medium text-ink">
        {isProcessing
          ? "파일을 읽는 중입니다..."
          : "카드 명세서를 여기로 드래그하거나 클릭해서 올려 주세요"}
      </p>
      <p className="text-sm text-muted">CSV(.csv) 또는 엑셀(.xlsx) 파일</p>
    </div>
  );
}
