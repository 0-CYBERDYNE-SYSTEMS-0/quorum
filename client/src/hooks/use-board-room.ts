import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWebSocket, sendWebSocketSubscription, sendWebSocketUnsubscription } from "@/lib/websocket-utils";
import { parseNewCommand } from "@/lib/new-command";
import type { Conversation, Expert, File as FileRecord, Insight, Message, OpenQuestion } from "@shared/schema";

export type InteractionMode = "idle" | "processing_sequential" | "paused" | "autonomous";

export type CompanyProfileView = {
  id?: number;
  userId?: number;
  companyName: string;
  industry: string;
  stage: string;
  headcount: string;
  revenueBand: string;
  businessModel: string;
  markets: string[];
  constraints: string;
  riskAppetite: string;
};

export type StreamView = { content: string; expertName: string; expertRole: string };

export function useBoardRoom() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeConversation, setActiveConversation] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("idle");
  const [isAutonomousEnabled, setIsAutonomousEnabled] = useState(true);
  const [expertTurnCounts, setExpertTurnCounts] = useState<{ consumed: number; remaining: number } | null>(null);
  const [hasQueuedMessage, setHasQueuedMessage] = useState(false);
  const [isConcluding, setIsConcluding] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<Map<number | null, StreamView>>(new Map());
  const [typingExpertIds, setTypingExpertIds] = useState<Set<number | null>>(new Set());
  const [upNextExpertId, setUpNextExpertId] = useState<number | null>(null);

  const { socket, status: socketStatus, reconnectAttempts } = useWebSocket();

  const conversationsQuery = useQuery<Conversation[]>({
    queryKey: ["/api/protected/conversations"],
    enabled: !!user,
  });

  const companyQuery = useQuery<{ profile: CompanyProfileView | null }>({
    queryKey: ["/api/protected/company-profile"],
    enabled: !!user,
  });

  const expertsQuery = useQuery<Expert[]>({
    queryKey: [`/api/protected/conversations/${activeConversation}/experts`],
    enabled: !!activeConversation,
  });

  const messagesQuery = useQuery<Message[]>({
    queryKey: [`/api/protected/conversations/${activeConversation}/messages`],
    enabled: !!activeConversation,
  });

  const openQuestionsQuery = useQuery<OpenQuestion[]>({
    queryKey: [`/api/protected/conversations/${activeConversation}/open-questions`],
    enabled: !!activeConversation,
  });

  const insightsQuery = useQuery<Insight[]>({
    queryKey: [`/api/protected/conversations/${activeConversation}/insights`],
    enabled: !!activeConversation,
  });

  const filesQuery = useQuery<FileRecord[]>({
    queryKey: [`/api/protected/conversations/${activeConversation}/files`],
    enabled: !!activeConversation,
  });

  const conversations = conversationsQuery.data ?? [];
  const experts = useMemo(() => expertsQuery.data ?? [], [expertsQuery.data]);
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const openQuestions = useMemo(() => openQuestionsQuery.data ?? [], [openQuestionsQuery.data]);
  const insights = insightsQuery.data ?? [];
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  const invalidateConversation = useCallback((conversationId: number) => {
    for (const section of ["messages", "experts", "insights", "files", "open-questions"]) {
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${conversationId}/${section}`] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/protected/conversations"] });
  }, []);

  const createConversationMutation = useMutation({
    mutationFn: async (title?: string) => {
      const res = await apiRequest("POST", "/api/protected/conversations", { title: title ?? "New board session" });
      return (await res.json()) as Conversation;
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/protected/conversations"] });
      setHasQueuedMessage(false);
      setActiveConversation(conversation.id);
    },
    onError: (error: Error) => {
      toast({ title: "Could not open a session", description: error.message, variant: "destructive" });
    },
  });

  const addExpertMutation = useMutation({
    mutationFn: async (expert: { name: string; role: string; model: string; avatarUrl: string; customInstructions?: string }) => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest("POST", `/api/protected/conversations/${activeConversation}/experts`, expert);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${activeConversation}/experts`] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not seat that director", description: error.message, variant: "destructive" });
    },
  });

  const removeExpertMutation = useMutation({
    mutationFn: async ({ conversationId, expertId }: { conversationId: number; expertId: number }) => {
      const response = await fetch(`/api/protected/conversations/${conversationId}/experts/${expertId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        let message = response.status === 404 ? "Director not found in this session." : response.statusText;
        try {
          const body = (await response.json()) as { message?: string };
          message = body.message || message;
        } catch {
          /* keep status message */
        }
        throw new Error(message || "Could not remove the director.");
      }
      return expertId;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${variables.conversationId}/experts`] });
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${variables.conversationId}/messages`] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove the director", description: error.message, variant: "destructive" });
    },
  });

  const sendMessageMutation = useMutation<
    Message,
    Error,
    { content: string; answersQuestionId?: number },
    { previousMessages?: Message[]; tempId?: number; conversationId?: number }
  >({
    mutationFn: async ({ content, answersQuestionId }) => {
      if (!activeConversation) throw new Error("No active session");
      if (!user) throw new Error("Not signed in");
      const path = answersQuestionId
        ? `/api/protected/conversations/${activeConversation}/open-questions/${answersQuestionId}/answer`
        : `/api/protected/conversations/${activeConversation}/messages`;
      const res = await apiRequest("POST", path, { content, userId: user.id });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Could not send the brief.");
      }
      return (await res.json()) as Message;
    },
    onMutate: async ({ content, answersQuestionId }) => {
      if (!activeConversation || !user) return {};
      const conversationId = activeConversation;
      const key = [`/api/protected/conversations/${conversationId}/messages`];
      await queryClient.cancelQueries({ queryKey: key });
      const previousMessages = queryClient.getQueryData<Message[]>(key);
      const tempId = Date.now();
      queryClient.setQueryData<Message[]>(key, (old = []) => [
        ...old,
        {
          id: tempId,
          conversationId,
          userId: user.id,
          expertId: null,
          content,
          role: "user",
          expertName: null,
          expertRole: null,
          answersQuestionId: answersQuestionId ?? (openQuestions.length === 1 ? openQuestions[0].id : null),
          timestamp: new Date(),
        } as Message,
      ]);
      return { previousMessages, tempId, conversationId };
    },
    onSuccess: (stored, _vars, context) => {
      if (!context?.conversationId || !context?.tempId) return;
      const key = [`/api/protected/conversations/${context.conversationId}/messages`];
      queryClient.setQueryData<Message[]>(key, (old = []) => {
        const withoutTemp = old.filter((m) => m.id !== context.tempId);
        if (withoutTemp.some((m) => m.id === stored.id)) return withoutTemp;
        return [...withoutTemp, stored];
      });
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${context.conversationId}/open-questions`] });
    },
    onError: (error, _vars, context) => {
      if (context?.conversationId) {
        const key = [`/api/protected/conversations/${context.conversationId}/messages`];
        if (context.previousMessages) queryClient.setQueryData(key, context.previousMessages);
        else if (context.tempId) {
          queryClient.setQueryData<Message[]>(key, (old = []) => old.filter((m) => m.id !== context.tempId));
        }
      }
      toast({ title: "Could not send the brief", description: error.message, variant: "destructive" });
    },
  });

  const restartMutation = useMutation({
    mutationFn: async ({ conversationId, topic }: { conversationId: number; topic?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/protected/conversations/${conversationId}/restart`,
        topic ? { topic } : {},
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Could not restart the session.");
      }
      return conversationId;
    },
    onSuccess: (conversationId) => {
      setHasQueuedMessage(false);
      invalidateConversation(conversationId);
    },
    onError: (error: Error) => {
      toast({ title: "Could not restart the session", description: error.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeConversation) throw new Error("No active session");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/protected/conversations/${activeConversation}/files`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${activeConversation}/files`] });
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${activeConversation}/messages`] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not attach that file", description: error.message, variant: "destructive" });
    },
  });

  const insightsMutation = useMutation({
    mutationFn: async () => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest("POST", `/api/protected/conversations/${activeConversation}/generate-insights`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${activeConversation}/insights`] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not refresh the record", description: error.message, variant: "destructive" });
    },
  });

  const autonomousMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest(
        "POST",
        `/api/protected/conversations/${activeConversation}/autonomous/${enabled ? "enable" : "disable"}`,
        {},
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Could not change deliberation mode.");
      }
      return enabled;
    },
    onSuccess: (enabled) => setIsAutonomousEnabled(enabled),
    onError: (error: Error) => {
      toast({ title: "Could not change deliberation mode", description: error.message, variant: "destructive" });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest("POST", `/api/protected/conversations/${activeConversation}/pause`);
      return await res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Could not pause", description: error.message, variant: "destructive" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest("POST", `/api/protected/conversations/${activeConversation}/resume`);
      return await res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Could not resume", description: error.message, variant: "destructive" });
    },
  });

  const concludeMutation = useMutation({
    mutationFn: async () => {
      if (!activeConversation) throw new Error("No active session");
      const res = await apiRequest("POST", `/api/protected/conversations/${activeConversation}/conclude`);
      return await res.json();
    },
    onSuccess: () => {
      setIsConcluding(false);
      setInteractionMode("idle");
      if (activeConversation) invalidateConversation(activeConversation);
    },
    onError: (error: Error) => {
      toast({ title: "Could not close the session", description: error.message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: number; title: string }) => {
      await apiRequest("PUT", `/api/protected/conversations/${conversationId}`, { title });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/protected/conversations"] }),
    onError: (error: Error) => {
      toast({ title: "Could not rename the session", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const response = await fetch(`/api/protected/conversations/${conversationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = (await response.json()) as { message?: string };
          message = body.message || message;
        } catch {
          /* keep status message */
        }
        throw new Error(message || "Could not delete the session.");
      }
      return conversationId;
    },
    onSuccess: (deletedId) => {
      const key = ["/api/protected/conversations"];
      const remaining = (queryClient.getQueryData<Conversation[]>(key) ?? conversations).filter((c) => c.id !== deletedId);
      queryClient.setQueryData<Conversation[]>(key, remaining);
      for (const section of ["messages", "experts", "insights", "files", "open-questions"]) {
        queryClient.removeQueries({ queryKey: [`/api/protected/conversations/${deletedId}/${section}`] });
      }
      if (activeConversation === deletedId) selectConversation(remaining[0]?.id ?? null);
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => {
      toast({ title: "Could not delete the session", description: error.message, variant: "destructive" });
    },
  });

  const selectConversation = useCallback((conversationId: number | null) => {
    setActiveConversation(conversationId);
    setStreamingMessages(new Map());
    setTypingExpertIds(new Set());
    setUpNextExpertId(null);
    setInteractionMode("idle");
    setHasQueuedMessage(false);
    setIsConcluding(false);
    setExpertTurnCounts(null);
  }, []);

  // Recover the most recent session on first load.
  const pickedInitial = useRef(false);
  useEffect(() => {
    if (pickedInitial.current) return;
    if (conversations.length > 0) {
      pickedInitial.current = true;
      setActiveConversation((current) => current ?? conversations[0].id);
    }
  }, [conversations]);

  const activeConversationData = conversations.find((c) => c.id === activeConversation) ?? null;

  useEffect(() => {
    const snapshot = activeConversationData?.orchestratorState;
    setIsAutonomousEnabled(typeof snapshot?.isAutonomousEnabled === "boolean" ? snapshot.isAutonomousEnabled : true);
  }, [activeConversation, activeConversationData?.orchestratorState]);

  // Subscribe to the active session's broadcasts.
  useEffect(() => {
    if (!socket || !activeConversation) return;
    const conversationId = activeConversation;
    let subscribed = false;
    const subscribe = () => {
      sendWebSocketSubscription(socket, conversationId);
      subscribed = true;
    };
    if (socket.readyState === WebSocket.OPEN) subscribe();
    else socket.addEventListener("open", subscribe, { once: true });
    return () => {
      socket.removeEventListener("open", subscribe);
      if (subscribed) sendWebSocketUnsubscription(socket, conversationId);
    };
  }, [socket, activeConversation]);

  useEffect(() => {
    if (!activeConversation) return;
    if (socketStatus === "connected") {
      const key = `/api/protected/conversations/${activeConversation}`;
      queryClient.invalidateQueries({ queryKey: [`${key}/messages`] });
      queryClient.invalidateQueries({ queryKey: [`${key}/experts`] });
      queryClient.invalidateQueries({ queryKey: [`${key}/insights`] });
      queryClient.invalidateQueries({ queryKey: [`${key}/files`] });
      queryClient.invalidateQueries({ queryKey: [`${key}/open-questions`] });
      return;
    }
    setStreamingMessages(new Map());
    setTypingExpertIds(new Set());
    setUpNextExpertId(null);
    setInteractionMode("idle");
    setHasQueuedMessage(false);
    setIsConcluding(false);
  }, [socketStatus, activeConversation]);

  useEffect(() => {
    if (!socket || !activeConversation) return;
    const activeSocket = socket;
    const conversationId = activeConversation;

    const onMessage = (event: MessageEvent) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.conversationId !== conversationId) return;
      const messagesKey = [`/api/protected/conversations/${conversationId}/messages`];
      const append = (message: Message) =>
        queryClient.setQueryData<Message[]>(messagesKey, (old = []) =>
          old.some((m) => m.id === message.id) ? old : [...old, message],
        );

      switch (data.type) {
        case "messages_updated":
        case "message_error": {
          if (data.type === "message_error") {
            setTypingExpertIds((prev) => {
              const next = new Set(prev);
              if (typeof data.expertId === "number") next.delete(data.expertId);
              else next.clear();
              return next;
            });
            setStreamingMessages((prev) => {
              if (typeof data.expertId !== "number") return new Map();
              const next = new Map(prev);
              next.delete(data.expertId);
              return next;
            });
          }
          if (data.message?.id) append(data.message as Message);
          else queryClient.invalidateQueries({ queryKey: messagesKey });
          break;
        }
        case "state_update": {
          if (data.mode) {
            setInteractionMode(data.mode as InteractionMode);
            if (data.mode === "processing_sequential" || data.mode === "idle" || data.mode === "paused") {
              setIsConcluding(false);
            }
            if (data.mode === "idle") {
              setStreamingMessages(new Map());
              setTypingExpertIds(new Set());
              setUpNextExpertId(null);
            }
          }
          if (typeof data.isAutonomousEnabled === "boolean") setIsAutonomousEnabled(data.isAutonomousEnabled);
          if (Number.isInteger(data.expertTurnsConsumed) && Number.isInteger(data.expertTurnsRemaining)) {
            setExpertTurnCounts({ consumed: data.expertTurnsConsumed, remaining: data.expertTurnsRemaining });
          }
          break;
        }
        case "message_queued":
          setHasQueuedMessage(true);
          break;
        case "message_picked_up":
          setHasQueuedMessage(false);
          break;
        case "open_questions_updated":
          queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${conversationId}/open-questions`] });
          break;
        case "concluding":
          setIsConcluding(true);
          break;
        case "expert_stream_start":
          setUpNextExpertId(null);
          setTypingExpertIds((prev) => new Set(prev).add(data.expertId));
          setStreamingMessages((prev) => {
            const next = new Map(prev);
            next.set(data.expertId, {
              content: "",
              expertName: data.expertName,
              expertRole: data.expertRole,
            });
            return next;
          });
          break;
        case "expert_stream_token":
          setStreamingMessages((prev) => {
            const next = new Map(prev);
            const existing = next.get(data.expertId);
            if (existing) next.set(data.expertId, { ...existing, content: existing.content + data.token });
            return next;
          });
          break;
        case "expert_stream_done":
          setTypingExpertIds((prev) => {
            const next = new Set(prev);
            next.delete(data.expertId);
            return next;
          });
          setStreamingMessages((prev) => {
            const next = new Map(prev);
            next.delete(data.expertId);
            return next;
          });
          if (data.message?.id) {
            append(data.message as Message);
            queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${conversationId}/files`] });
          }
          break;
        case "insights":
          queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${conversationId}/insights`] });
          break;
        case "next_speaker":
          setUpNextExpertId(data.expertId);
          break;
        case "error":
          toast({
            title: "The board hit a problem",
            description: data.message || "That turn could not be completed. Try again.",
            variant: "destructive",
          });
          setStreamingMessages(new Map());
          setTypingExpertIds(new Set());
          setUpNextExpertId(null);
          setInteractionMode("idle");
          setIsConcluding(false);
          break;
        case "notice":
          toast({ description: data.message });
          break;
        default:
          break;
      }
    };

    activeSocket.addEventListener("message", onMessage);
    return () => activeSocket.removeEventListener("message", onMessage);
  }, [socket, activeConversation, toast]);

  const send = useCallback(
    (content: string, answersQuestionId?: number) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const topic = parseNewCommand(trimmed);
      if (topic !== null) {
        if (!activeConversation) return;
        restartMutation.mutate({ conversationId: activeConversation, ...(topic ? { topic } : {}) });
        return;
      }
      sendMessageMutation.mutate({ content: trimmed, answersQuestionId });
    },
    [activeConversation, restartMutation, sendMessageMutation],
  );

  const startSession = useCallback(
    async (title?: string) => {
      const conversation = await createConversationMutation.mutateAsync(title);
      setActiveConversation(conversation.id);
      return conversation;
    },
    [createConversationMutation],
  );

  const seatExperts = useCallback(
    async (seats: { name: string; role: string; model: string; avatarUrl: string; customInstructions?: string }[]) => {
      if (!activeConversation) throw new Error("No active session");
      await Promise.all(
        seats.map((seat) =>
          apiRequest("POST", `/api/protected/conversations/${activeConversation}/experts`, seat),
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: [`/api/protected/conversations/${activeConversation}/experts`],
      });
    },
    [activeConversation],
  );

  const removeSeat = useCallback(async (expertId: number) => {
    if (!activeConversation) return;
    await removeExpertMutation.mutateAsync({ conversationId: activeConversation, expertId });
  }, [activeConversation, removeExpertMutation]);

  const updateSeat = useCallback(async (expertId: number, patchBody: { customInstructions?: string; name?: string }) => {
    await apiRequest("PATCH", `/api/experts/${expertId}`, patchBody);
    if (activeConversation) {
      await queryClient.invalidateQueries({ queryKey: [`/api/protected/conversations/${activeConversation}/experts`] });
    }
  }, [activeConversation]);

  const isDeliberating = interactionMode === "processing_sequential" || interactionMode === "autonomous";
  const isBusy = isDeliberating || isConcluding || sendMessageMutation.isPending || restartMutation.isPending;

  return {
    user,
    conversations,
    conversationsLoading: conversationsQuery.isLoading,
    conversationsError: conversationsQuery.isError,
    activeConversation,
    activeConversationData,
    selectConversation,
    startSession,
    isCreatingSession: createConversationMutation.isPending,
    experts,
    expertsLoading: expertsQuery.isLoading,
    messages,
    messagesLoading: messagesQuery.isLoading,
    messagesError: messagesQuery.isError,
    openQuestions,
    insights,
    files,
    companyProfile: companyQuery.data?.profile ?? null,
    companyProfileLoading: companyQuery.isLoading,
    send,
    isSending: sendMessageMutation.isPending,
    isDeliberating,
    isBusy,
    isConcluding,
    hasQueuedMessage,
    interactionMode,
    isAutonomousEnabled,
    setAutonomous: (enabled: boolean) => autonomousMutation.mutate(enabled),
    isChangingAutonomous: autonomousMutation.isPending,
    pause: () => pauseMutation.mutate(),
    resume: () => resumeMutation.mutate(),
    conclude: () => concludeMutation.mutate(),
    isConcludingSession: concludeMutation.isPending,
    isPausing: pauseMutation.isPending || resumeMutation.isPending,
    expertTurnCounts,
    streamingMessages,
    typingExpertIds,
    upNextExpertId,
    addExpert: (expert: { name: string; role: string; model: string; avatarUrl: string; customInstructions?: string }) =>
      addExpertMutation.mutate(expert),
    seatExperts,
    isSeating: addExpertMutation.isPending,
    removeExpert: (expertId: number) =>
      activeConversation && removeExpertMutation.mutate({ conversationId: activeConversation, expertId }),
    removeSeat,
    updateSeat,
    uploadFile: (file: File) => {
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: `"${file.name}" is over the 10 MB limit.`, variant: "destructive" });
        return;
      }
      uploadMutation.mutate(file);
    },
    isUploading: uploadMutation.isPending,
    refreshInsights: () => insightsMutation.mutate(),
    isRefreshingInsights: insightsMutation.isPending,
    renameSession: (conversationId: number, title: string) => renameMutation.mutate({ conversationId, title }),
    deleteSession: (conversationId: number) => deleteMutation.mutate(conversationId),
    socketStatus,
    reconnectAttempts,
    invalidateConversation,
  };
}

export type BoardRoom = ReturnType<typeof useBoardRoom>;
