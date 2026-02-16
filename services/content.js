const announcementRepo = require('../db/repos/announcements');
const galleryRepo = require('../db/repos/gallery');
const biosRepo = require('../db/repos/bios');
const storage = require('./storage');

// --- Announcements ---

async function listAnnouncements() {
  return await announcementRepo.findAll();
}

async function listPublishedAnnouncements() {
  return await announcementRepo.findAllPublished();
}

async function getAnnouncement(id) {
  return await announcementRepo.findById(id);
}

async function createAnnouncement(data) {
  return await announcementRepo.create(data);
}

async function updateAnnouncement(id, data) {
  return await announcementRepo.update(id, data);
}

async function deleteAnnouncement(id) {
  const imagePath = await announcementRepo.getImagePath(id);
  storage.deleteFile(imagePath).catch(() => {});
  await announcementRepo.deleteById(id);
}

async function getAnnouncementImagePath(id) {
  return await announcementRepo.getImagePath(id);
}

// --- Gallery ---

async function listGalleryImages() {
  return await galleryRepo.findAll();
}

async function listVisibleGalleryImages() {
  return await galleryRepo.findAllVisible();
}

async function getGalleryImage(id) {
  return await galleryRepo.findById(id);
}

async function createGalleryImage(data) {
  return await galleryRepo.create(data);
}

async function updateGalleryImage(id, data) {
  return await galleryRepo.update(id, data);
}

async function deleteGalleryImage(id) {
  const filename = await galleryRepo.getFilename(id);
  storage.deleteFile(filename).catch(() => {});
  await galleryRepo.deleteById(id);
}

async function getGalleryFilename(id) {
  return await galleryRepo.getFilename(id);
}

// --- Bios ---

async function listBios() {
  return await biosRepo.findAll();
}

async function listVisibleBios() {
  return await biosRepo.findAllVisible();
}

async function getBio(id) {
  return await biosRepo.findById(id);
}

async function createBio(data) {
  return await biosRepo.create(data);
}

async function updateBio(id, data) {
  return await biosRepo.update(id, data);
}

async function deleteBio(id) {
  const photoPath = await biosRepo.getPhotoPath(id);
  storage.deleteFile(photoPath).catch(() => {});
  await biosRepo.deleteById(id);
}

async function getBioPhotoPath(id) {
  return await biosRepo.getPhotoPath(id);
}

module.exports = {
  listAnnouncements,
  listPublishedAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementImagePath,
  listGalleryImages,
  listVisibleGalleryImages,
  getGalleryImage,
  createGalleryImage,
  updateGalleryImage,
  deleteGalleryImage,
  getGalleryFilename,
  listBios,
  listVisibleBios,
  getBio,
  createBio,
  updateBio,
  deleteBio,
  getBioPhotoPath,
};
