// React hook for Web Push subscription management.
// Handles permission requests, subscription lifecycle, and server synchronization.

import { useState, useEffect } from 'react';
import { fetchVapidPublicKey, subscribePush, unsubscribePush } from '../api/client.js';

// Utility to convert VAPID public key from base64url to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushSubscription() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [loading, setLoading] = useState(false);

  // Check for existing subscription on mount
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    const checkExistingSubscription = async () => {
      try {
        setPermission(Notification.permission);
        const registration = await navigator.serviceWorker.ready;
        const existingSubscription = await registration.pushManager.getSubscription();

        if (existingSubscription) {
          setSubscription(existingSubscription);
          // Sync to server (idempotent)
          await subscribePush(existingSubscription.toJSON());
        }
      } catch (error) {
        console.error('Failed to check existing subscription:', error);
      }
    };

    void checkExistingSubscription();
  }, []);

  const subscribe = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return;
    }

    setLoading(true);
    try {
      // Request permission
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== 'granted') {
        return; // Don't throw, just exit
      }

      // Fetch VAPID public key
      const { publicKey } = await fetchVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // Subscribe via PushManager
      const registration = await navigator.serviceWorker.ready;
      const newSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Send subscription to server
      await subscribePush(newSubscription.toJSON());

      setSubscription(newSubscription);
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (!subscription) {
      return;
    }

    setLoading(true);
    try {
      await subscription.unsubscribe();
      await unsubscribePush(subscription.endpoint);
      setSubscription(null);
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  return { permission, subscription, loading, subscribe, unsubscribe };
}
