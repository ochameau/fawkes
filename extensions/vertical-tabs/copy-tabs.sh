#!/bin/bash

cp -r ../tabs/* .

sed -i s/horizontal/vertical/g manifest.json 
sed -i 's/tabs": "tabs.html/vertical-tabs": "tabs.html/' manifest.json

sed -i 's/<html>/<html class="vertical-tabs">/' tabs.html

sed -i 's/<link rel="stylesheet" href="style.css">/<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="vertical-style.css">/' tabs.html
