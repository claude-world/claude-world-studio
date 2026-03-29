import React from "react";

export function SkeletonLine({
  width = "100%",
  height = "16px",
}: {
  width?: string;
  height?: string;
}) {
  return (
    <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded" style={{ width, height }} />
  );
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <SkeletonLine width="60%" height="20px" />
      <SkeletonLine width="100%" />
      <SkeletonLine width="80%" />
    </div>
  );
}

// Pre-computed widths to avoid Math.random() during render (impure function)
const SESSION_SKELETON_WIDTHS = ["72%", "55%", "88%", "63%", "79%"];
const FILE_SKELETON_WIDTHS = ["60%", "85%", "45%", "70%", "55%", "80%", "65%"];

export function SessionSkeleton() {
  return (
    <div className="space-y-2 px-3">
      {SESSION_SKELETON_WIDTHS.map((width, i) => (
        <div key={i} className="animate-pulse flex items-center gap-2 p-2 rounded-lg">
          <div className="flex-1 space-y-1.5">
            <SkeletonLine width={width} height="14px" />
            <SkeletonLine width="30%" height="10px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileTreeSkeleton() {
  return (
    <div className="space-y-1.5 p-3">
      {FILE_SKELETON_WIDTHS.map((width, i) => (
        <div
          key={i}
          className="animate-pulse flex items-center gap-2"
          style={{ paddingLeft: `${(i % 3) * 16}px` }}
        >
          <SkeletonLine width="12px" height="12px" />
          <SkeletonLine width={width} height="14px" />
        </div>
      ))}
    </div>
  );
}

export function PostsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
