pipeline {
    agent any

    stages {

        stage('Install') {
            steps {
                sh '''
                echo "Creating virtual environment..."
                python3 -m venv venv

                echo "Installing dependencies..."
                . venv/bin/activate
                pip install -r requirements.txt || true
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                echo "Running tests..."
                . venv/bin/activate
                python3 -m unittest discover || true
                '''
            }
        }

        stage('AI Security Scan') {
            steps {
                sh '''
                echo "Running security scan..."
                . venv/bin/activate
                python3 security_scan.py
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                echo "Building Docker image..."
                docker build -t ai-secure-app .
                '''
            }
        }

        stage('Vulnerability Scan (Trivy)') {
            steps {
                sh '''
                echo "Scanning Docker image with Trivy..."
                trivy image ai-secure-app
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo "Deploying application (simulation)..."
            }
        }
    }

    post {
        success {
            echo "✅ Pipeline completed successfully"
        }
        failure {
            echo "❌ Pipeline failed"
        }
    }
}
