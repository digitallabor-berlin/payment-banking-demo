"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export interface QrCanvasProps {
  value: string;
  /** Rendered edge length in px. Default 240 (spec 9.5). */
  size?: number;
  /** Dark module colour. Default black; pass a brand colour to theme it. */
  darkColor?: string;
  lightColor?: string;
  className?: string;
  /** Accessible label; the canvas itself conveys nothing to a screen reader. */
  ariaLabel?: string;
}

export function QrCanvas({
  value,
  size = 240,
  darkColor = "#000000",
  lightColor = "#ffffff",
  className,
  ariaLabel = "QR code",
}: QrCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: darkColor, light: lightColor },
    }).catch(() => {
      // A malformed value should not take the page down; the surrounding
      // component already renders the URI as copyable text.
    });
  }, [value, size, darkColor, lightColor]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
    />
  );
}