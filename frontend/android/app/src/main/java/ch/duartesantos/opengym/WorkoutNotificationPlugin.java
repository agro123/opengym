package ch.duartesantos.opengym;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge for the workout notification (see src/lib/workout-notif.js). The web app decides what
 * the notification says; this hands that to {@link WorkoutService} and reports the buttons
 * tapped on it back as "action" events. No workout logic lives on this side.
 */
@CapacitorPlugin(name = "WorkoutNotification")
public class WorkoutNotificationPlugin extends Plugin {
    private static WorkoutNotificationPlugin instance;
    /** Whether the app is on screen — the web app does its own rest-over alert when it is. */
    static volatile boolean foreground = false;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    @Override
    protected void handleOnDestroy() {
        // The session lives in the WebView; without it the buttons would do nothing.
        getContext().stopService(new Intent(getContext(), WorkoutService.class));
        instance = null;
    }

    @PluginMethod
    public void update(PluginCall call) {
        String state = call.getData().toString();
        // A running service is redrawn in place: starting a foreground service is only allowed
        // while the app is visible, and updates keep coming after it no longer is.
        if (!WorkoutService.show(state)) {
            Intent intent = new Intent(getContext(), WorkoutService.class).putExtra(WorkoutService.EXTRA_STATE, state);
            try {
                ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException e) {
                call.reject("Could not start the workout notification", e);
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getContext().stopService(new Intent(getContext(), WorkoutService.class));
        call.resolve();
    }

    /** Called off the notification's buttons, and by the service when the rest runs out. */
    static void emit(String action) {
        WorkoutNotificationPlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        plugin.notifyListeners("action", data, true);
    }
}
