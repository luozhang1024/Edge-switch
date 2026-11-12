import React from "react";

export function ActionIcon({
  name,
}: {
  name:
    | "activate"
    | "edit"
    | "copy"
    | "test"
    | "delete"
    | "eye"
    | "hidden"
    | "settings"
    | "logs"
    | "login"
    | "launch"
    | "upgrade"
    | "terminal"
    | "authorization"
    | "usage"
    | "prompts";
}) {
  const paths = {
    prompts:
      "M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1ZM12 5v15",
    terminal: "M3 4h18v16H3ZM7 9l3 3-3 3M13 15h4",
    authorization: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-6",
    usage: "M4 3v18h17M8 16v-5M13 16V6M18 16V9",
    login: "M14 3h7v18h-7M3 12h13M11 7l5 5-5 5",
    launch: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
    logs: "M6 3h9l4 4v14H5V3ZM14 3v5h5M8 12h8M8 16h8",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l.7 3 2 .9 2.7-.9 2 3.5-2.2 2.1v2.8l2.2 2.1-2 3.5-2.7-.9-2 .9-.7 3h-4l-.7-3-2-.9-2.7.9-2-3.5 2.2-2.1v-2.8L2.6 8.5l2-3.5 2.7.9 2-.9Z",
    upgrade: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 16V8M8 12l4-4 4 4",
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
