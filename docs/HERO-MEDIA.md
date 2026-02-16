# Hero Media Feature

The YSH home page now supports a hero section with either a high-resolution photo or video background.

## Features

✅ **Photo Support** - Display high-res images (JPG, PNG, GIF, WebP)
✅ **Video Support** - Display background videos (MP4, WebM, MOV)
✅ **No Stretching** - Media displays at natural aspect ratio using `object-fit: contain`
✅ **Responsive** - Works on all screen sizes
✅ **Text Overlay** - Hero content appears over the media with semi-transparent background
✅ **Auto-play Videos** - Videos loop automatically, muted by default

## How to Use

### 1. Access Admin Settings

1. Log in to admin: `/admin/login`
2. Navigate to Settings: `/admin/settings`
3. Scroll to "Hero Media Type" section

### 2. Configure Hero Media

**Option 1: Photo Background**
1. Set "Hero Media Type" to **Photo**
2. Click "Upload Hero Photo/Video"
3. Select an image file (JPG, PNG, GIF, WebP)
4. Click "Save Settings"

**Option 2: Video Background**
1. Set "Hero Media Type" to **Video**
2. Click "Upload Hero Photo/Video"
3. Select a video file (MP4, WebM, MOV)
4. Click "Save Settings"

**Option 3: No Media (Text Only)**
1. Set "Hero Media Type" to **None**
2. Click "Save Settings"
3. Hero will display text with solid blue background

### 3. Media Specifications

**File Size Limits:**
- Maximum: 50MB (for both photos and videos)

**Supported Formats:**
- **Photos**: JPG, JPEG, PNG, GIF, WebP
- **Videos**: MP4, WebM, MOV

**Recommended Sizes:**
- **Photos**: 1920x1080 or higher for HD displays
- **Videos**: 1080p or 720p for optimal performance

**Video Requirements:**
- Videos auto-play on page load
- Videos are muted by default
- Videos loop continuously
- No controls displayed

## Display Behavior

### Natural Sizing (No Stretching)
The media is displayed using `object-fit: contain`, which means:
- ✅ Original aspect ratio is preserved
- ✅ No distortion or stretching
- ✅ Media is scaled to fit within the hero container
- ✅ Letterboxing or pillarboxing may occur if aspect ratios don't match

### Hero Content Overlay
When media is present:
- Hero text appears in a semi-transparent blue box
- Box ensures text is readable over any media
- Button remains visible and clickable

When no media is present:
- Hero shows solid blue background
- Text displays without overlay box
- Classic YSH branding look

## CSS Implementation

The hero section uses the following CSS approach:

```css
.hero {
  position: relative;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-media {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000;
}

.hero-image,
.hero-video {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain; /* Key: prevents stretching */
}

.hero-content {
  position: relative;
  z-index: 10;
  background: rgba(0, 42, 92, 0.85);
  padding: 3rem 2rem;
}
```

## Examples

### Photo Hero
```
Hero Media Type: Photo
Upload: team-photo-2026.jpg (1920x1080)
Result: Full-width hero with team photo, text overlay on top
```

### Video Hero
```
Hero Media Type: Video
Upload: seahawks-highlights.mp4 (1280x720)
Result: Auto-playing looping video with text overlay
```

### Text-Only Hero
```
Hero Media Type: None
Result: Traditional blue background with white text
```

## Troubleshooting

### Video Not Playing
- Ensure video format is MP4, WebM, or MOV
- Check file size is under 50MB
- Videos must be properly encoded
- Browser may block autoplay (videos are muted to allow autoplay)

### Image Quality Issues
- Use high-resolution images (1920x1080 minimum)
- Avoid overly compressed JPGs
- Consider using PNG for crisp graphics
- WebP offers best compression with quality

### Media Not Displaying
1. Check "Hero Media Type" is set correctly
2. Verify file was uploaded successfully
3. Check browser console for errors
4. Ensure media URL is accessible

### Aspect Ratio Issues
- Media will maintain its natural aspect ratio
- Letterboxing (black bars top/bottom) occurs if video is wider than container
- Pillarboxing (black bars left/right) occurs if video is taller than container
- This is intentional to prevent stretching!

## Performance Tips

**For Photos:**
- Optimize images before upload
- Use WebP format for smallest file size
- Compress JPGs to ~80% quality
- Maximum recommended: 5MB

**For Videos:**
- Compress videos before upload
- Use H.264 codec for MP4
- Target 720p for good quality/size balance
- Keep under 10MB for fast loading
- Remove audio track (it's muted anyway)

## Technical Details

**Database Fields:**
- `hero_media_type` - Values: 'none', 'photo', 'video'
- `hero_media_url` - Path to uploaded media file

**Video Attributes:**
- `autoplay` - Starts playing automatically
- `muted` - No audio (required for autoplay)
- `loop` - Repeats continuously
- `playsinline` - Plays inline on mobile (not fullscreen)

**File Storage:**
- Files uploaded to `data/uploads/hero/` (local) or cloud storage (production)
- Original filenames preserved with timestamp prefix

## Best Practices

✅ **Do:**
- Use high-quality media
- Optimize files before upload
- Test on mobile devices
- Keep videos under 10MB
- Use relevant, engaging content
- Ensure text remains readable over media

❌ **Don't:**
- Upload massive uncompressed files
- Use portrait-oriented videos for landscape hero
- Rely solely on media to convey critical information
- Upload videos with loud audio (they're muted)
- Change media too frequently (consistency is good)

## Future Enhancements

Potential additions:
- Multiple hero slides with transitions
- Mobile-specific media (different image/video for small screens)
- Parallax scrolling effects
- Play/pause controls for videos
- Custom overlay opacity settings
