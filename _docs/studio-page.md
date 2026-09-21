Build the StudioPage:

Topbar: home icon that shows a modal saying "Are you sure you want to exit?" with yes and no. later I'll add more stuff to this bar but it should be very thin.

Screen should be split into 3 thirds. The left and right are 2 identical CDJ (so a reusable component). 

A CDJ should display a zoomable 1-band waveform , along with a mini-waveform underneath it. It should be the same as the TrackPreview component in the TracksPage, except a few differences. No fields are editable and grid lines aren't movable. There should be no controls bar either. Clicking on the waveform should move the playhead as usual but snap to the nearest beat (snap to grid always on)

Controls exist underneath the Track Preview. 
On the bottom left, we should see a play/pause button and a "cue" button on top, that when pressed, overwrites the next null cue to the current playhead position if exists. 
On the bottom right, we should see the 8 cue buttons (use existing component). These are for navigating to cues. If 
In the middle should be a circle which is the spinning record. It should rotate when playing. Don't add any controls to this yet.
In the middle right, above the 8 cue buttons, add a tempo slider. It shouldn't do anything yet.

Between the 2 cdj's is the middle third.
It should have knobs for high, mid, and low frequencies, arranged vertically, with a total volume slider beneathe. There should be 2 sets of this, one for each CDJ.

