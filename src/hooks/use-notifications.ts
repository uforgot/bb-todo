"use client";

import { useCallback, useEffect, useRef } from "react";
import { type Project } from "@/hooks/use-projects";

const NOTIFIED_KEY = "bb-todo-notified";
const DATE_REGEX = /(\d{4}-\d{2}-\d{2})/;

function getNotified(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveNotified(notified: Set<string>) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified]));
}

function isWithin24h(dateStr: string): boolean {
  const target = new Date(dateStr + "T23:59:59");
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  // Due within 24h (and not more than 1 day past)
  return diff >= -86400000 && diff <= 86400000;
}

function getDueLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return "오늘";
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return "내일";
  return dateStr;
}

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      permissionRef.current = Notification.permission;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      permissionRef.current = "granted";
      return;
    }
    if (Notification.permission === "denied") return;
    const result = await Notification.requestPermission();
    permissionRef.current = result;
  }, []);

  const checkDeadlines = useCallback((projects: Project[]) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (permissionRef.current !== "granted") return;

    const notified = getNotified();
    const items: { title: string; id: number; date: string }[] = [];

    for (const project of projects) {
      for (const item of project.items) {
        if (item.status === "done") continue;
        const match = item.title.match(DATE_REGEX);
        if (match && isWithin24h(match[1])) {
          items.push({ title: item.title, id: item.id, date: match[1] });
        }
      }
      for (const cat of project.categories) {
        for (const item of cat.items) {
          if (item.status === "done") continue;
          const match = item.title.match(DATE_REGEX);
          if (match && isWithin24h(match[1])) {
            items.push({ title: item.title, id: item.id, date: match[1] });
          }
        }
      }
    }

    for (const item of items) {
      const key = `${item.id}:${item.date}`;
      if (notified.has(key)) continue;

      const label = getDueLabel(item.date);
      new Notification(`bb-todo 마감 알림 (${label})`, {
        body: item.title,
        icon: "/icons/icon-192x192.png",
        tag: key,
      });
      notified.add(key);
    }

    saveNotified(notified);
  }, []);

  return { requestPermission, checkDeadlines };
}
