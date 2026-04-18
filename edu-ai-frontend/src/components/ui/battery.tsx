"use client";
import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface BatteryProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  progress: number;
  color: string;
}

export const Battery = ({ icon: Icon, title, subtitle, progress, color }: BatteryProps) => {
  const circumference = 2 * Math.PI * 40;
  const gap = ((100 - progress) / 100) * circumference;

  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.style.transition = "stroke-dashoffset 0.8s ease-out";
      circleRef.current.style.strokeDashoffset = String(gap);
    }
  }, [gap]);

  // bg-linear-to-br from-[color/25] to-[color/10] etc.
  return (
    <div 
      className="relative rounded-3xl p-4 overflow-hidden border shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 group flex flex-col justify-between"
      style={{ 
        backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`, 
        borderColor: `color-mix(in srgb, ${color} 20%, transparent)` 
      }}
    >
      <div className="absolute top-0 right-0 p-3 opacity-[0.08] pointer-events-none group-hover:scale-110 group-hover:-rotate-12 transition-transform duration-500">
        <Icon className="w-28 h-28" style={{ color }} />
      </div>
      
      <div className="relative size-16 drop-shadow-sm mb-4">
        <svg viewBox="0 0 100 100" className="absolute right-0 size-full">
          <circle cx={50} cy={50} r={40} stroke="currentColor" className="text-muted/20" strokeWidth={8} fill="none" />
          <circle
            ref={circleRef}
            cx={50}
            cy={50}
            r={40}
            stroke={color}
            strokeWidth={8}
            fill="none"
            strokeDashoffset={circumference}
            strokeDasharray={circumference}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            className="drop-shadow-sm"
          />
        </svg>
        <div className="absolute inset-0 flex size-full items-center justify-center">
          <Icon size={24} style={{ color }} />
        </div>
      </div>
      
      <div className="mt-auto relative z-10 flex flex-col gap-1">
        <div className="text-4xl font-light tracking-tight" style={{ color }}>
          {progress}
          <small className="text-sm font-medium opacity-80 opacity-60 ml-0.5">%</small>
        </div>
        <div className="flex flex-col mt-1 space-y-0.5">
          <span className="font-semibold text-[0.95rem] text-foreground tracking-tight">{title}</span>
          <span className="text-[11px] font-medium tracking-wide opacity-80" style={{ color }}>{subtitle}</span>
        </div>
      </div>
    </div>
  );
};

export default Battery;
