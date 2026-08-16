"use client";

import { useEffect, useState, useCallback, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Bell, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaNotificationProvider({ children }: { children: ReactNode }) {
  const { accountId, user } = useAuth();
  const userId = user?.id;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  // 1. Register Service Worker & Check Notification Permission
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service worker registered:', reg.scope);
        })
        .catch((err) => {
          console.error('[PWA] Service worker registration failed:', err);
        });
    }

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
      if (Notification.permission === 'default') {
        // Show subtle notification prompt banner after 3 seconds
        const timer = setTimeout(() => setShowNotificationPrompt(true), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // 2. Capture PWA beforeinstallprompt event
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Hide install banner if app is already installed
    window.addEventListener('appinstalled', () => {
      setInstallPrompt(null);
      setShowInstallBanner(false);
      console.log('[PWA] App installed successfully');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  // Function to trigger Browser Notification
  const sendBrowserNotification = useCallback((title: string, body: string, url: string = '/inbox') => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const options: NotificationOptions = {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `nande-crm-${Date.now()}`,
      data: { url },
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, options);
      });
    } else {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        window.location.href = url;
      };
    }
  }, []);

  // 3. Supabase Realtime Listener for Messages & Notifications
  useEffect(() => {
    if (!accountId || typeof window === 'undefined' || Notification.permission !== 'granted') return;

    const supabase = createClient();

    // Listen to real-time assigned notifications
    const notifChannel = supabase
      .channel('pwa-realtime-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as {
            user_id?: string;
            title?: string;
            body?: string;
            conversation_id?: string;
          };
          if (!userId || row.user_id === userId) {
            sendBrowserNotification(
              row.title || 'Nueva notificación',
              row.body || 'Tienes una nueva tarea asignada en Ñande CRM',
              row.conversation_id ? `/inbox?c=${row.conversation_id}` : '/notifications'
            );
          }
        }
      )
      .subscribe();

    // Listen to incoming messages
    const msgChannel = supabase
      .channel('pwa-realtime-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const msg = payload.new as {
            direction?: string;
            sender_name?: string;
            text?: string;
            conversation_id?: string;
          };
          // Only notify inbound messages from customers
          if (msg.direction === 'inbound') {
            sendBrowserNotification(
              `Mensaje de ${msg.sender_name || 'Cliente'}`,
              msg.text || '📄 [Archivo/Media recibido]',
              `/inbox?c=${msg.conversation_id}`
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(msgChannel);
    };
  }, [accountId, userId, sendBrowserNotification]);

  // Handler to request Notification permission
  const handleRequestNotification = async () => {
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    setNotificationPermission(res);
    setShowNotificationPrompt(false);

    if (res === 'granted') {
      sendBrowserNotification(
        'Ñande CRM',
        '¡Notificaciones del navegador activadas correctamente!'
      );
    }
  };

  // Handler to trigger PWA installation
  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
      setShowInstallBanner(false);
    }
  };

  return (
    <>
      {children}

      {/* Floating Notification Permission Banner */}
      {showNotificationPrompt && notificationPermission === 'default' && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-foreground">
              ¿Activar notificaciones?
            </h4>
            <p className="text-xs text-muted-foreground">
              Recibí alertas instantáneas cuando te asignen un chat o llegue un mensaje.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleRequestNotification}>
              Activar
            </Button>
            <button
              onClick={() => setShowNotificationPrompt(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating PWA Install Banner */}
      {showInstallBanner && installPrompt && (
        <div className="fixed bottom-4 left-4 z-50 flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Download className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-foreground">
              Instalar Ñande CRM
            </h4>
            <p className="text-xs text-muted-foreground">
              Instalá la app en tu celular o PC para un acceso rápido y notificaciones directas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleInstallPwa}>
              Instalar
            </Button>
            <button
              onClick={() => setShowInstallBanner(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
