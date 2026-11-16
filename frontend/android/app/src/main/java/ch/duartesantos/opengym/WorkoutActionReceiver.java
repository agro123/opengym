package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives taps on the workout notification's buttons and passes them to the web app. */
public class WorkoutActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent.getAction() != null) WorkoutNotificationPlugin.emit(intent.getAction());
    }
}
