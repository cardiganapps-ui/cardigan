import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import type { NotificationRow } from "../types/rows";

/* In-app notification inbox actions (read / clear). Mirrors the optimistic-
   update + revert pattern of the other domain modules. Rows are created
   server-side only (cron reminders + admin/system) — the client never
   inserts, it only flips `read` or deletes its own rows (RLS enforces
   auth.uid() = user_id on both).

   Note: distinct from src/hooks/useNotifications.js, which manages PUSH
   subscription state (enable/disable/permission). This is the durable inbox
   data domain. */
export function createInboxActions(
  userId: string,
  notifications: NotificationRow[],
  setNotifications: Dispatch<SetStateAction<NotificationRow[]>>,
  setMutationError: (msg: string) => void,
) {
  const markNotificationRead = async (id: string) => {
    const prev = notifications;
    if (!prev.some((n) => n.id === id && !n.read)) return true;
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      setNotifications(prev);
      setMutationError(error.message);
      return false;
    }
    return true;
  };

  const markAllNotificationsRead = async () => {
    const prev = notifications;
    if (!prev.some((n) => !n.read)) return true;
    setNotifications((list) => list.map((n) => (n.read ? n : { ...n, read: true })));
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) {
      setNotifications(prev);
      setMutationError(error.message);
      return false;
    }
    return true;
  };

  const deleteNotification = async (id: string) => {
    const prev = notifications;
    setNotifications((list) => list.filter((n) => n.id !== id));
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      setNotifications(prev);
      setMutationError(error.message);
      return false;
    }
    return true;
  };

  const clearNotifications = async () => {
    const prev = notifications;
    if (prev.length === 0) return true;
    setNotifications([]);
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    if (error) {
      setNotifications(prev);
      setMutationError(error.message);
      return false;
    }
    return true;
  };

  return { markNotificationRead, markAllNotificationsRead, deleteNotification, clearNotifications };
}
