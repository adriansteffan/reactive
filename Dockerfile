FROM node:21-bookworm-slim

RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install -y git curl software-properties-common apache2
WORKDIR /srv/frontend

# this assumes build context one directory up
COPY ./frontend .
COPY .env .env

RUN npm install
RUN a2enmod rewrite
RUN sed -i 's%/var/www/html%/srv/frontend/dist%g' /etc/apache2/sites-available/000-default.conf && sed -i 's%ServerTokens OS%ServerTokens Prod%g' /etc/apache2/conf-available/security.conf && sed -i 's%ServerSignature On%ServerSignature Off%g' /etc/apache2/conf-available/security.conf && sed -i 's%<Directory /var/www/>%<Directory /srv/frontend/dist/>%g' /etc/apache2/apache2.conf && sed -i 's|AllowOverride None|AllowOverride All\nOptions -MultiViews\nRewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteRule ^ index.html [QSA,L]|g' /etc/apache2/apache2.conf
RUN npm run build
RUN rm .env

EXPOSE 80

CMD ["apachectl","-D","FOREGROUND"]