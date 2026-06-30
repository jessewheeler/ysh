# YSH Board Member Testing Guide

Thank you for helping us test the membership system before launch. This guide walks through the key flows to verify.

**Production URL:** yellowstoneseahawkers.org

---

## 1. New Individual Membership (may not be testable in production for members who already exist in the system)

**What we're testing:** A brand-new member signs up and pays online.

1. Go to `/membership`
2. Confirm the page shows two plan cards (Individual / Family) but **no form fields yet**
3. Click **Individual** — a "Verify you're human" captcha should appear below the cards
4. Complete the captcha — the name/email/address form should animate in below it
5. Fill in your details and click **Continue to Payment**
6. Complete checkout via Stripe.
7. After payment you should land on a success page
8. Check your email — you should receive a welcome email and a membership card delivery email with your card attached

**Expected:** Member record created, status Active, card generated.

---

## 2. New Family Membership (may not be testable in production for members who already exist in the system)

**What we're testing:** A family signs up with additional members.

1. Go to `/membership`
2. Click **Family** — captcha appears, complete it — form appears
3. Fill in your details
4. In the "Additional Family Members" section, click **+ Add Family Member** and add at least one family member name
5. Complete checkout with the test card
6. Check email — welcome email and card should arrive

**Expected:** Primary member and each family member get their own card.

---

## 3. Returning Member — Smart Renewal Detection

**What we're testing:** Someone who already has an account tries to sign up again. The system should recognize them and send a renewal email instead of creating a duplicate.

1. Go to `/membership`, select a plan, complete captcha, fill in the form using **an email address that already has a membership account**
2. Click **Continue to Payment**
3. You should **not** be sent to Stripe — instead you should see a green success message: *"We found your existing membership. A renewal link has been sent to [email]."*
4. Check that email — you should receive a renewal link
5. Click the renewal link, update your details if needed, and complete checkout

**Expected:** No duplicate account created; renewal processed through the link.

---

## 4. Already-a-Member Detection

**What we're testing:** Someone who already paid for the current season tries to sign up again.

1. Use an email that has already completed payment for the current season
2. Go to `/membership`, select a plan, complete captcha, enter that email, submit
3. You should see: *"You're already a member for this season! Check your email for your membership card."*
4. No email should be sent

---

## What to Report

If anything doesn't work as described, please log an issue in the GitHub repo:

**https://github.com/jessewheeler/ysh/issues/new**

In your issue, include:

- Which test scenario you were running (e.g., "Test 1 — New Individual Membership")
- What you expected to happen
- What actually happened
- A screenshot if there's a visual problem

You don't need a GitHub account to view the repo, but you will need one to open an issue. If that's a barrier, send the
details to Jesse directly via email.
