const express = require('express')
const router = express.Router();
const appointmentRoute = require("./appointmentRoutes")
const queueRoute = require("./queueRoutes")
const scheduleRoute = require("./scheduleRoutes")


//http://localhost:3007/api/v1/

router.use('/appointments', appointmentRoute);
router.use('/queue', queueRoute);
router.use('/schedules', scheduleRoute);
module.exports = router;
