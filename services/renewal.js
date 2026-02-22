const crypto = require('crypto');
const membersRepo = require('../db/repos/members');
const settingsRepo = require('../db/repos/settings');
const emailService = require('./email');
const logger = require('./logger');

async function generateRenewalToken(memberId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days
    await membersRepo.setRenewalToken(memberId, token, expiresAt);
    return token;
}

async function findMembersNeedingRenewal() {
    const daysStr = await settingsRepo.get('renewal_reminder_days_before') || '30';
    const days = parseInt(daysStr);
    const currentYear = new Date().getFullYear();
    return membersRepo.findNeedingRenewal(currentYear, days);
}

async function sendBulkRenewalReminders(baseUrl) {
    const members = await findMembersNeedingRenewal();
    let sent = 0, failed = 0;
    for (const member of members) {
        try {
            const token = await generateRenewalToken(member.id);
            const renewalLink = `${baseUrl}/renew/${token}`;
            await emailService.sendRenewalReminderEmail(member, renewalLink);
            sent++;
        } catch (e) {
            logger.error('Renewal reminder failed for member', {
                error: e.message,
                memberId: member.id,
                email: member.email
            });
            failed++;
        }
    }
    logger.info('Bulk renewal reminders completed', {sent, failed, total: members.length});
    return {sent, failed, total: members.length};
}

module.exports = {generateRenewalToken, findMembersNeedingRenewal, sendBulkRenewalReminders};
