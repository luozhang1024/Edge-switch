import React from "react";

export function ActionIcon({
  name,
}: {
  name: "activate" | "edit" | "copy" | "test" | "delete" | "eye" | "hidden";
}) {
  const paths = {
    activate: "m8 4 12 8-12 8Z",
    edit: "m16 3 5 5-12 12H4v-5ZM14 5l5 5M12 4H4v16h16v-8",
    copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
    test: "M8 3h8M10 3v7L4 20h16l-6-10V3M8 15h8",
    delete: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
    eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    hidden:
      "m3 3 18 18M9 5a12 12 0 0 1 3 0c7 0 10 7 10 7a19 19 0 0 1-4 5M6 6a20 20 0 0 0-4 6s3 7 10 7a13 13 0 0 0 5-1M10 10a3 3 0 0 0 4 4",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
