/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const es = require("event-stream");
const vfs = require("vinyl-fs");
const util = require("../lib/util");
const filter = require("gulp-filter");
const gzip = require("gulp-gzip");
const identity_1 = require("@azure/identity");
const azure = require('gulp-azure-storage');
const root = path.dirname(path.dirname(__dirname));
const commit = util.getVersion(root);
const credential = new identity_1.ClientSecretCredential(process.env['AZURE_TENANT_ID'], process.env['AZURE_CLIENT_ID'], process.env['AZURE_CLIENT_SECRET']);
function main() {
    return new Promise((c, e) => {
        vfs.src('**', { cwd: '../vscode-web', base: '../vscode-web', dot: true })
            .pipe(filter(f => !f.isDirectory()))
            .pipe(gzip({ append: false }))
            .pipe(es.through(function (data) {
            console.log('Uploading CDN file:', data.relative); // debug
            this.emit('data', data);
        }))
            .pipe(azure.upload({
            account: process.env.AZURE_STORAGE_ACCOUNT,
            credential,
            container: process.env.VSCODE_QUALITY,
            prefix: commit + '/',
            contentSettings: {
                contentEncoding: 'gzip',
                cacheControl: 'max-age=31536000, public'
            }
        }))
            .on('end', () => c())
            .on('error', (err) => e(err));
    });
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
