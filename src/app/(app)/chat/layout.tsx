import { Suspense } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

/**
 * The AI Workspace lives in the layout so its state (optimistic messages, conversation list)
 * survives navigation between /chat and /chat/[id]. The pages themselves render nothing.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <ChatWorkspace />
      </Suspense>
      {children}
    </>
  );
}
