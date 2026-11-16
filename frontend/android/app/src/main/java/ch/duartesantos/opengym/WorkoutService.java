package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Keeps the workout notification up — and with it the app's process, so the buttons on it
 * still reach the web app while it is in the background.
 *
 * Built the way a clock app builds its timer, not as a media player: the player card belongs to
 * whatever music is playing alongside. A plain ongoing notification with standard action
 * buttons (which work from the lock screen and a paired watch), asked to be a Live Update on
 * Android 16 — the status-bar chip, and Samsung's Now Bar on One UI 8. Promotion is refused to
 * a notification with custom views, which is why there are none.
 *
 * It wears the app's accent colour (a colorized notification, which Android allows a foreground
 * service) and, on Android 16, a ProgressStyle bar through the whole session — one segment
 * per exercise, filled set by set. During a rest the bar gives way to the next exercise's
 * picture at full width, expanded (a notification has one style): that is when you set up
 * for it, and the bar has not moved anyway.
 *
 * Three faces, picked by the state's "mode": "set" (the next set, a -/+ for the number that
 * moves between sets, and Done), "rest" (a live countdown with -15s / +15s / Skip) and
 * "idle" (nothing left to check off — the button finishes the workout). All wording arrives
 * ready-made in the state.
 */
public class WorkoutService extends Service {
    static final String EXTRA_STATE = "state";
    // Importance is fixed when a channel is created, so raising it took a new id. "Default"
    // rather than "low" is what puts the notification in the main list — and shows it in
    // full on the lock screen — instead of folded away with the silent ones.
    private static final String CHANNEL = "workout_live";
    private static final String OLD_CHANNEL = "workout";
    private static final int ID = 4201;
    private static final long[] BUZZ = { 0, 200, 100, 200 };
    // three short ticks: "get ready", told apart by feel from the two long ones of "go"
    private static final long[] BUZZ_SOON = { 0, 40, 90, 40, 90, 40 };
    private static final long SOON_MS = 3000;
    private static final int COVER_PX = 512;
    // Android 16 (API 36) extras, spelled out while the project compiles against API 35:
    // Notification.EXTRA_REQUEST_PROMOTED_ONGOING and the chip's short text.
    private static final String EXTRA_PROMOTE = "android.requestPromotedOngoing";
    private static final String EXTRA_CHIP_TEXT = "android.shortCriticalText";
    // ProgressStyle draws at most this many segments; longer sessions share them out.
    private static final int MAX_SEGMENTS = 15;

    private static WorkoutService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private String coverUri = "";
    private Bitmap cover;

    private final Runnable restSoon = () -> buzz(BUZZ_SOON);

    // The rest ran out. The web app owns the timer, so it is told rather than overruled; it
    // answers with the next set's state. It can't make itself felt from the background though.
    private final Runnable restEnd = () -> {
        WorkoutNotificationPlugin.emit("restEnd");
        if (!WorkoutNotificationPlugin.foreground) buzz(BUZZ);
    };

    /** One button: the action reported to the web app, its label and its icon. */
    private static final class Btn {
        final String action;
        final String label;
        final int icon;

        Btn(String action, String label, int icon) {
            this.action = action;
            this.label = label;
            this.icon = icon;
        }
    }

    /** Redraws the notification of a running service; false if there is none to redraw. */
    static boolean show(String state) {
        WorkoutService service = instance;
        if (service == null) return false;
        Notification n = service.apply(state);
        if (n != null) service.getSystemService(NotificationManager.class).notify(ID, n);
        return true;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.workout_channel), NotificationManager.IMPORTANCE_DEFAULT);
            // visible, not noisy: it is redrawn on every tap
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(channel);
            nm.deleteNotificationChannel(OLD_CHANNEL);
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = intent == null ? null : apply(intent.getStringExtra(EXTRA_STATE));
        if (n == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, ID, n, type);
            instance = this;
        } catch (RuntimeException e) {
            // Started while the app was not visible (Android 12+ refuses that). The next
            // update made with the app on screen starts it again.
            stopSelf();
        }
        // Not restarted after being killed: the state it would need died with the process.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped out of recents — the WebView is gone, and the buttons would be dead.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacks(restEnd);
        handler.removeCallbacks(restSoon);
        if (wakeLock.isHeld()) wakeLock.release();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Takes a new state: (re)arms the rest alarms and builds the matching notification. */
    private Notification apply(String state) {
        JSONObject s;
        try {
            s = new JSONObject(state);
        } catch (JSONException | NullPointerException e) {
            return null;
        }
        handler.removeCallbacks(restEnd);
        handler.removeCallbacks(restSoon);
        if (wakeLock.isHeld()) wakeLock.release();
        String mode = s.optString("mode");
        boolean rest = "rest".equals(mode);
        long now = System.currentTimeMillis();
        long left = rest ? Math.max(0, s.optLong("endsAt") - now) : 0;
        if (rest) {
            // Held for the length of the rest only: with the screen off the CPU would
            // otherwise sleep through the end of it and the alert would arrive late.
            wakeLock.acquire(left + 5000);
            handler.postDelayed(restEnd, left);
            if (left > SOON_MS) handler.postDelayed(restSoon, left - SOON_MS);
        }

        List<Btn> btns = new ArrayList<>();
        if (rest) {
            btns.add(new Btn("rest-", s.optString("minus"), R.drawable.ic_act_rewind));
            btns.add(new Btn("rest+", s.optString("plus"), R.drawable.ic_act_forward));
            btns.add(new Btn("skip", s.optString("skip"), R.drawable.ic_act_skip));
        } else if ("set".equals(mode)) {
            int f = s.optInt("step", 2);
            btns.add(new Btn("f" + f + "-", s.optString("down"), R.drawable.ic_act_minus));
            btns.add(new Btn("f" + f + "+", s.optString("up"), R.drawable.ic_act_plus));
            btns.add(new Btn("done", s.optString("done"), R.drawable.ic_act_check));
        } else if (s.has("done")) {
            btns.add(new Btn("finish", s.optString("done"), R.drawable.ic_act_flag));
        }

        String title = s.optString("title");
        CharSequence line = "idle".equals(mode) ? s.optString("progress") : s.optString("text");
        // the set's numbers stand out, its position in the exercise follows in plain text
        if ("set".equals(mode) && s.has("value")) line = bold(s.optString("value"), " · " + s.optString("pos"));
        int accent = color(s.optString("accent"));
        // the line under it when expanded: what comes next, during a set
        String more = "set".equals(mode) ? s.optString("next") : "";

        // A rest counts down to its end; otherwise the clock counts up from the session start.
        long when = rest ? now + left : s.optLong("start", now);
        Bundle extras = new Bundle();
        extras.putBoolean(EXTRA_PROMOTE, true);
        // the chip in the status bar has room for a few characters: the set's numbers
        if ("set".equals(mode)) extras.putString(EXTRA_CHIP_TEXT, s.optString("chip"));

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        NotificationCompat.Builder n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_workout)
            .setLargeIcon(cover(s.optString("image")))
            .setContentTitle(bold(title, ""))
            .setColor(accent)
            .setColorized(true)
            .setContentText(line)
            .setSubText(s.optString("progress"))
            .setWhen(when)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(rest)
            .addExtras(extras)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true);
        Bitmap picture = rest ? cover(s.optString("image")) : null;
        if (picture != null) {
            // expanded, the picture takes the width — and the thumbnail beside the text goes
            n.setStyle(new NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon((Bitmap) null));
        } else if (!more.isEmpty()) n.setStyle(new NotificationCompat.BigTextStyle().bigText(new SpannableStringBuilder(line).append("\n").append(more)));
        for (int i = 0; i < btns.size(); i++) {
            Btn b = btns.get(i);
            n.addAction(new NotificationCompat.Action.Builder(b.icon, b.label, action(b.action, i + 1))
                // a quick tap from the lock screen or the watch, no unlocking first
                .setAuthenticationRequired(false)
                .build());
        }
        if (picture != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) return n.build();
        return withProgress(n.build(), s, accent, more);
    }

    /**
     * Android 16: the same notification with a progress bar through the session. One segment per
     * exercise, sized by its sets and in alternating shades of the accent, so the bar reads as
     * the workout's outline; the dumbbell rides the tip of what is done. The "next" line moves
     * to the header, since the progress layout has no room for a second line of text.
     */
    private Notification withProgress(Notification base, JSONObject s, int accent, String more) {
        JSONArray segs = s.optJSONArray("segs");
        int total = 0;
        for (int i = 0; segs != null && i < segs.length(); i++) total += segs.optInt(i);
        if (total <= 0) return base;
        // with more exercises than segments, neighbours share one
        int per = (segs.length() + MAX_SEGMENTS - 1) / MAX_SEGMENTS;
        int faded = (accent & 0x00FFFFFF) | 0x80000000;
        List<Notification.ProgressStyle.Segment> parts = new ArrayList<>();
        for (int i = 0; i < segs.length(); i += per) {
            int len = 0;
            for (int j = i; j < Math.min(i + per, segs.length()); j++) len += segs.optInt(j);
            parts.add(new Notification.ProgressStyle.Segment(len).setColor(parts.size() % 2 == 0 ? accent : faded));
        }
        Notification.ProgressStyle style = new Notification.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressSegments(parts)
            .setProgress(Math.min(total, s.optInt("doneSets")))
            .setProgressTrackerIcon(Icon.createWithResource(this, R.drawable.ic_stat_workout));
        Notification.Builder b = Notification.Builder.recoverBuilder(this, base).setStyle(style);
        if (!more.isEmpty()) b.setSubText(more);
        return b.build();
    }

    /** `strong` in bold, followed by `rest` as it is. */
    private static CharSequence bold(String strong, String rest) {
        SpannableStringBuilder t = new SpannableStringBuilder(strong);
        t.setSpan(new StyleSpan(Typeface.BOLD), 0, strong.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return t.append(rest);
    }

    /** The app's accent, as the web app sends it ("#30d158"); its lime if missing or unreadable. */
    private static int color(String hex) {
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return Color.parseColor("#30d158");
        }
    }

    private PendingIntent action(String name, int requestCode) {
        Intent intent = new Intent(this, WorkoutActionReceiver.class).setAction(name);
        return PendingIntent.getBroadcast(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The exercise picture, scaled down to what a notification shows; null if there is none. */
    private Bitmap cover(String uri) {
        if (uri.equals(coverUri)) return cover;
        coverUri = uri;
        cover = null;
        String path = uri.isEmpty() ? null : Uri.parse(uri).getPath();
        if (path == null) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / opts.inSampleSize > COVER_PX) opts.inSampleSize *= 2;
        cover = BitmapFactory.decodeFile(path, opts);
        return cover;
    }

    @SuppressWarnings("deprecation")
    private void buzz(long[] pattern) {
        Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
        else vibrator.vibrate(pattern, -1);
    }
}
