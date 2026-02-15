const announcementRepo = require('../db/repos/announcements');
const galleryRepo = require('../db/repos/gallery');
const biosRepo = require('../db/repos/bios');
const storage = require('./storage');

// --- Announcements ---

function listAnnouncements() {
  return announcementRepo.findAll();
}

function listPublishedAnnouncements() {
  return announcementRepo.findAllPublished();
}

function getAnnouncement(id) {
  return announcementRepo.findById(id);
}

function createAnnouncement(data) {
  return announcementRepo.create(data);
}

function updateAnnouncement(id, data) {
  return announcementRepo.update(id, data);
}

async function deleteAnnouncement(id) {
  const imagePath = announcementRepo.getImagePath(id);
  storage.deleteFile(imagePath).catch(() => {});
  announcementRepo.deleteById(id);
}

function getAnnouncementImagePath(id) {
  return announcementRepo.getImagePath(id);
}

// --- Gallery ---

function listGalleryImages() {
  return galleryRepo.findAll();
}

function listVisibleGalleryImages() {
  return galleryRepo.findAllVisible();
}

function getGalleryImage(id) {
  return galleryRepo.findById(id);
}

function createGalleryImage(data) {
  return galleryRepo.create(data);
}

function updateGalleryImage(id, data) {
  return galleryRepo.update(id, data);
}

async function deleteGalleryImage(id) {
  const filename = galleryRepo.getFilename(id);
  storage.deleteFile(filename).catch(() => {});
  galleryRepo.deleteById(id);
}

function getGalleryFilename(id) {
  return galleryRepo.getFilename(id);
}

// --- Bios ---

function listBios() {
  return biosRepo.findAll();
}

function listVisibleBios() {
  return biosRepo.findAllVisible();
}

function getBio(id) {
  return biosRepo.findById(id);
}

function createBio(data) {
  return biosRepo.create(data);
}

function updateBio(id, data) {
  return biosRepo.update(id, data);
}

async function deleteBio(id) {
  const photoPath = biosRepo.getPhotoPath(id);
  storage.deleteFile(photoPath).catch(() => {});
  biosRepo.deleteById(id);
}

function getBioPhotoPath(id) {
  return biosRepo.getPhotoPath(id);
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
