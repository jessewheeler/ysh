# Membership Cards

## Overview

Membership cards are generated as both PDF and PNG files. Each card includes:

- Navy header with the YSH logo and "Official Member Card" title
- Member's full name, member number, and season year
- "ACTIVE MEMBER" badge
- Green footer with "Go Hawks!" text

Cards are stored on the server and indexed by member and year, so regenerating a card for the same year replaces the previous version.

## Generating a Card

1. Navigate to a member's detail page via **Members** > click the member's name.
2. Click the **Generate Card** button.
3. The system creates both a PDF and a PNG version.
4. Download links appear on the page once generation is complete.

## Downloading Cards

On the member detail page, each generated card shows two download links:

- **PDF** — suitable for printing
- **PNG** — suitable for digital use (email, mobile wallet)

Click either link to download the file directly.

## Emailing a Card

From the member detail page you can email the card directly to the member. The email includes both the PDF and PNG as attachments, using the standard YSH branded email template.

## Card Templates

Each membership period can have its own card template image (the background art used when generating cards). If no
template is set for a period, the system falls back to the default template.

To upload a card template:

1. Navigate to **Periods** in the sidebar (super admin only).
2. Click **Edit** on the season you want to update.
3. Upload a PNG or PDF in the **Card Template** field.
    - PNG files are used as-is.
    - PDF files are automatically converted to PNG via Ghostscript and ImageMagick — make sure those tools are installed
      on the server.
4. Click **Save**. New cards generated for members enrolled in that period will use the uploaded template.

## Automatic Card Generation

When a new member completes payment through Stripe, cards are generated automatically as part of the post-payment workflow. The member receives their card via email without any admin action required.
