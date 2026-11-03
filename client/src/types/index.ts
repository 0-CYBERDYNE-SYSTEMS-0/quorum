import { User as SchemaUser, Expert as SchemaExpert, Message as SchemaMessage, Conversation as SchemaConversation, Insight as SchemaInsight, File as SchemaFile } from "@shared/schema";

// Re-export types from schema
export type User = SchemaUser;
export type Expert = SchemaExpert;
export type Message = SchemaMessage;
export type Conversation = SchemaConversation;
export type Insight = SchemaInsight;
export type File = SchemaFile;

// Multimodal content parts (mirrors server/ai.ts ContentPart) — image_url
// parts carry uploaded images as base64 data URLs for vision-capable models.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// AI Message format for API calls
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

// AI Model Response
export interface AIModelResponse {
  message: {
    role: string;
    content: string;
  };
  citations?: string[];
}

// Subscription info
export interface SubscriptionInfo {
  subscribed: boolean;
  status: string;
}

// WebSocket message types
export type WebSocketMessageType = 
  | "message"
  | "expert_typing"
  | "insights"
  | "file_upload"
  | "connection";

// WebSocket Message
export interface WebSocketMessage {
  type: WebSocketMessageType;
  conversationId: number;
  data: any;
}

// Expert data for selection
export interface ExpertData {
  role: string;
  description: string;
  model: string;
  avatarUrl: string;
}

// Chat message with user/expert metadata
export interface ChatMessage extends SchemaMessage {
  sender?: User | Expert;
  isUser: boolean;
}

// File upload progress
export interface FileUploadProgress {
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
}

// Expert role options
export enum ExpertRole {
  SoilScientist = "Soil Scientist",
  CropSpecialist = "Crop Specialist",
  IrrigationEngineer = "Irrigation Engineer",
  PestManagement = "Pest Management",
  Meteorologist = "Meteorologist",
  FileCreator = "File Creator",
  ResearchAnalyst = "Research Analyst",
  ImagerySpecialist = "Imagery Specialist",
  Moderator = "Moderator"
}
